#!/usr/bin/env python3
"""Local preview and writing server for this site. No dependencies; Python 3.8 or newer.

    python3 scripts/local_server.py [--port 8080]

1. Serves the site folder at http://localhost:8080/ to this computer only, and tells the browser
   not to keep copies, so a page always shows the latest files.
2. Lets the writing page (/write/) publish straight into the site folder, with no GitHub key.
   It answers the few GitHub calls that page makes (read a file, list posts/, save a file) under
   /api/github/. After a post is saved it rebuilds the blog (node build.mjs) and records the change
   with git as a local commit. Nothing is sent to GitHub from here.

Safety: the server listens on 127.0.0.1 only; the /api/ addresses accept requests from this site's
own pages only; and the only files that can be written are posts/<date>-<title>.md and pictures
under images/blog/<year>/<post>/.
"""
import argparse
import base64
import glob
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

POST_RE = re.compile(r'^posts/\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$')
IMAGE_RE = re.compile(r'^images/blog/\d{4}/[a-z0-9]+(?:-[a-z0-9]+)*/[a-z0-9]+(?:-[a-z0-9]+)*\.(?:png|jpg|webp|gif)$')
READABLE_RE = re.compile(r'^(?:posts(?:/[^/]+\.md)?|images/blog(?:/[^/]+)*|\.github/workflows/build\.yml)$')
MAX_POST = 2 * 1024 * 1024
MAX_IMAGE = 12 * 1024 * 1024
MAX_BODY = 20 * 1024 * 1024

# What a published post changes: the post, its pictures, and the pages the build writes
COMMIT_PATHS = ['posts', 'images/blog', 'blog', 'index.html', 'search.json', 'rss_feed.xml', 'sitemap.xml', 'robots.txt',
                'llms.txt', 'llms-full.txt', 'blog.html', '404.html', 'css/blog-state.css', 'css/katex', 'js/vendor']

WRITE_LOCK = threading.Lock()  # one save (and one build) at a time


def find_node():
    """The newest Node 20+ on this computer (the blog build needs it), or (None, None)."""
    def version(path):
        m = re.search(r'/v(\d+)\.(\d+)\.(\d+)/', path)
        return tuple(int(x) for x in m.groups()) if m else (0, 0, 0)

    candidates = [os.environ.get('WEBSITE_NODE')]
    candidates += sorted(glob.glob(os.path.expanduser('~/.nvm/versions/node/v*/bin/node')), key=version, reverse=True)
    candidates += [shutil.which('node'), '/opt/homebrew/bin/node', '/usr/local/bin/node']
    for candidate in candidates:
        if not candidate or not os.path.exists(candidate):
            continue
        try:
            out = subprocess.run([candidate, '--version'], capture_output=True, text=True, timeout=15).stdout.strip()
        except (OSError, subprocess.SubprocessError):
            continue
        m = re.match(r'v(\d+)\.', out)
        if m and int(m.group(1)) >= 20:
            return candidate, out
    return None, None


NODE, NODE_VERSION = find_node()


def blob_sha(data):
    """The id git gives to a file with this content (what GitHub calls "sha")."""
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def read_file(full):
    with open(full, 'rb') as f:
        return f.read()


def write_file(full, data):
    os.makedirs(os.path.dirname(full), exist_ok=True)
    temp = full + '.part'
    with open(temp, 'wb') as f:
        f.write(data)
    os.replace(temp, full)


def run_build():
    """Rebuild the blog. Returns (ok, message for the writer when it failed)."""
    if not NODE:
        return False, 'Node 20 or newer was not found on this computer, so the blog cannot be rebuilt. Install Node 22 from nodejs.org, then start the website again.'
    try:
        done = subprocess.run([NODE, 'build.mjs'], cwd=ROOT, capture_output=True, text=True, timeout=240)
    except subprocess.TimeoutExpired:
        return False, 'Rebuilding the blog took too long and was stopped.'
    except OSError as error:
        return False, 'The blog could not be rebuilt: %s' % error
    if done.returncode == 0:
        return True, ''
    lines = [line.strip() for line in (done.stderr + '\n' + done.stdout).splitlines() if line.strip()]
    marked = [line.lstrip('✖ ').strip() for line in lines if line.startswith('✖')]
    return False, ' '.join(marked or lines[-3:]) or 'The blog could not be rebuilt.'


def git_commit(message):
    """Record the change in the project history. Returns '' or a short note when that did not work."""
    if not shutil.which('git') or not os.path.isdir(os.path.join(ROOT, '.git')):
        return ''
    paths = [p for p in COMMIT_PATHS if os.path.exists(os.path.join(ROOT, p))]
    try:
        subprocess.run(['git', 'add', '-A', '--'] + paths, cwd=ROOT, capture_output=True, text=True, timeout=120, check=True)
        if subprocess.run(['git', 'diff', '--cached', '--quiet', '--'] + paths, cwd=ROOT, timeout=120).returncode == 0:
            return ''  # nothing changed
        done = subprocess.run(['git', 'commit', '-q', '-m', message, '--'] + paths, cwd=ROOT, capture_output=True, text=True, timeout=120)
        if done.returncode != 0:
            return 'The post is saved, but it could not be recorded in the project history (%s).' % ((done.stderr or done.stdout).strip().splitlines() or ['git error'])[-1]
    except (OSError, subprocess.SubprocessError) as error:
        return 'The post is saved, but it could not be recorded in the project history (%s).' % error
    return ''


class Handler(SimpleHTTPRequestHandler):
    server_version = 'SiteLocal/1.0'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *args):  # keep the window quiet
        pass

    # ------------------------------------------------------------ routing
    def do_GET(self):
        if self.path.startswith('/api/'):
            return self.api('GET')
        if any(part.startswith('.') for part in urllib.parse.urlsplit(self.path).path.split('/') if part):
            return self.send_error(404)  # .git and other hidden folders are not pages
        return super().do_GET()

    def do_HEAD(self):
        if self.path.startswith('/api/') or any(part.startswith('.') for part in urllib.parse.urlsplit(self.path).path.split('/') if part):
            return self.send_error(404)
        return super().do_HEAD()

    def do_PUT(self):
        return self.api('PUT') if self.path.startswith('/api/') else self.send_error(405)

    def do_POST(self):
        return self.send_error(405)

    def do_OPTIONS(self):
        return self.send_error(403)  # no page of another site may use this server

    # ------------------------------------------------------------ helpers
    def reply(self, status, data):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def from_this_site(self, method):
        """True for requests made by this site's own pages (or by a tool on this computer)."""
        if (self.headers.get('Host') or '').lower() not in self.server.hosts:
            return False
        origin = self.headers.get('Origin')
        if origin is not None and origin.lower() not in self.server.origins:
            return False
        if (self.headers.get('Sec-Fetch-Site') or 'same-origin') not in ('same-origin', 'none'):
            return False
        if method != 'GET' and 'application/json' not in (self.headers.get('Content-Type') or '').lower():
            return False
        return True

    # ------------------------------------------------------------ /api/
    def api(self, method):
        if not self.from_this_site(method):
            return self.reply(403, {'message': 'Only the pages of this site may use this address.'})
        path = urllib.parse.urlsplit(self.path).path
        if path == '/api/local/ping' and method == 'GET':
            return self.reply(200, {'local': True, 'node': NODE_VERSION, 'folder': os.path.basename(ROOT)})
        if not path.startswith('/api/github/'):
            return self.reply(404, {'message': 'Not Found'})
        rest = path[len('/api/github/'):]
        if rest == 'user' and method == 'GET':
            return self.reply(200, {'login': ''})
        m = re.match(r'^repos/[^/]+/[^/]+(?:/(.*))?$', rest)
        if not m:
            return self.reply(404, {'message': 'Not Found'})
        tail = m.group(1) or ''
        if tail == '' and method == 'GET':
            return self.reply(200, {'permissions': {'push': True}})
        if tail.startswith('actions/runs') and method == 'GET':
            return self.reply(200, {'workflow_runs': []})
        if tail.startswith('contents/'):
            rel = urllib.parse.unquote(tail[len('contents/'):]).strip('/')
            if '..' in rel.split('/') or '\\' in rel:
                return self.reply(404, {'message': 'Not Found'})
            return self.read_content(rel) if method == 'GET' else self.write_content(rel)
        return self.reply(404, {'message': 'Not Found'})

    def read_content(self, rel):
        full = os.path.join(ROOT, rel)
        if not READABLE_RE.match(rel) or not os.path.exists(full):
            return self.reply(404, {'message': 'Not Found'})
        if os.path.isdir(full):
            entries = []
            for name in sorted(os.listdir(full)):
                child = os.path.join(full, name)
                if name.startswith('.') or name.endswith('.part'):
                    continue
                entries.append({'name': name, 'path': rel + '/' + name, 'type': 'dir' if os.path.isdir(child) else 'file',
                                'sha': '' if os.path.isdir(child) else blob_sha(read_file(child))})
            return self.reply(200, entries)
        data = read_file(full)
        return self.reply(200, {'name': os.path.basename(rel), 'path': rel, 'type': 'file', 'sha': blob_sha(data),
                                'encoding': 'base64', 'content': base64.b64encode(data).decode('ascii')})

    def write_content(self, rel):
        is_post, is_image = bool(POST_RE.match(rel)), bool(IMAGE_RE.match(rel))
        if not (is_post or is_image):
            return self.reply(422, {'message': 'Only posts (posts/<date>-<title>.md) and their pictures (images/blog/…) can be saved from the writing page.'})
        try:
            length = int(self.headers.get('Content-Length') or 0)
            if length <= 0 or length > MAX_BODY:
                raise ValueError('size')
            body = json.loads(self.rfile.read(length).decode('utf-8'))
            data = base64.b64decode(body['content'], validate=False)
        except (ValueError, KeyError, TypeError, UnicodeDecodeError):
            return self.reply(422, {'message': 'The request could not be read.'})
        if len(data) > (MAX_POST if is_post else MAX_IMAGE):
            return self.reply(422, {'message': 'This file is too large.'})
        full = os.path.join(ROOT, rel)
        with WRITE_LOCK:
            old = read_file(full) if os.path.isfile(full) else None
            given = body.get('sha') or ''
            if old is not None and not given:
                return self.reply(422, {'message': 'A file with this name already exists.'})
            if old is not None and given != blob_sha(old):
                return self.reply(409, {'message': 'The file was changed after it was opened.'})
            write_file(full, data)
            note = ''
            if is_post:
                ok, problem = run_build()
                if not ok:
                    # put things back as they were, so one bad post never breaks the site
                    if old is None:
                        os.remove(full)
                    else:
                        write_file(full, old)
                    run_build()
                    return self.reply(422, {'message': problem, 'build_failed': True})
                message = re.sub(r'\s+', ' ', str(body.get('message') or 'Update a post')).strip()[:150]
                note = git_commit(message)
        return self.reply(200 if old is not None else 201,
                          {'content': {'name': os.path.basename(rel), 'path': rel, 'sha': blob_sha(data)}, 'commit': {'sha': 'local'}, 'note': note})


def main():
    parser = argparse.ArgumentParser(description='Serve this site on this computer, with the writing page able to publish locally.')
    parser.add_argument('--port', type=int, default=int(os.environ.get('WEBSITE_PORT') or 8080))
    args = parser.parse_args()
    os.chdir(ROOT)
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    except OSError as error:
        sys.exit('  Port %d is already used by another program (%s).' % (args.port, error))
    server.hosts = {'localhost:%d' % args.port, '127.0.0.1:%d' % args.port}
    server.origins = {'http://localhost:%d' % args.port, 'http://127.0.0.1:%d' % args.port}
    if not NODE:
        print('  Note: Node 20 or newer was not found, so new posts cannot be built. Reading the site works.')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n  Stopped.')


if __name__ == '__main__':
    main()
