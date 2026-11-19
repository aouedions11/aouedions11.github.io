/* site.js — progressive enhancements for every page (home, talks, blog):
   mobile navigation, the highlights card on the home page, auto-hiding header, search,
   archive filters, and on posts the contents list that follows the reading position,
   copy buttons, and figure zoom (theme.js handles the theme).
   No dependencies. Every feature degrades gracefully when its markup is absent. */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;

  /* ---------------------------------------------------------- mobile nav */
  var navToggle = doc.querySelector('.mobile-menu-toggle');
  var siteNav = doc.querySelector('.site-nav');
  if (navToggle && siteNav) {
    navToggle.addEventListener('click', function () {
      var open = navToggle.getAttribute('aria-expanded') === 'true';
      navToggle.setAttribute('aria-expanded', String(!open));
      siteNav.classList.toggle('mobile-open', !open);
    });
    /* close the menu after choosing a link (same-page anchors on the home page) */
    siteNav.addEventListener('click', function (event) {
      if (event.target.closest('a')) {
        navToggle.setAttribute('aria-expanded', 'false');
        siteNav.classList.remove('mobile-open');
      }
    });
  }

  /* ---------------------------------------------------------- highlights (home page) */
  /* Without this script every highlight is shown, one under the other. */
  var spotlight = doc.querySelector('[data-spotlight]');
  var slides = spotlight ? Array.prototype.slice.call(spotlight.querySelectorAll('.spotlight__item')) : [];
  if (slides.length > 1) {
    var currentSlide = 0;
    var spotNav = doc.createElement('div');
    var spotDots = doc.createElement('div');
    var arrowButton = function (label, text, step) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.className = 'spotlight__btn';
      b.setAttribute('aria-label', label);
      b.textContent = text;
      b.addEventListener('click', function () { showSlide(currentSlide + step); });
      return b;
    };
    var dots = slides.map(function (slide, i) {
      var d = doc.createElement('button');
      d.type = 'button';
      d.className = 'spotlight__dot';
      d.setAttribute('aria-label', 'Highlight ' + (i + 1) + ' of ' + slides.length);
      d.addEventListener('click', function () { showSlide(i); });
      spotDots.appendChild(d);
      return d;
    });
    var showSlide = function (i) {
      currentSlide = (i + slides.length) % slides.length;
      slides.forEach(function (slide, k) { slide.hidden = k !== currentSlide; });
      dots.forEach(function (d, k) {
        if (k === currentSlide) d.setAttribute('aria-current', 'true');
        else d.removeAttribute('aria-current');
      });
    };
    spotNav.className = 'spotlight__nav';
    spotDots.className = 'spotlight__dots';
    spotNav.appendChild(arrowButton('Previous highlight', '\u2190', -1));
    spotNav.appendChild(spotDots);
    spotNav.appendChild(arrowButton('Next highlight', '\u2192', 1));
    spotlight.appendChild(spotNav);
    spotlight.classList.add('is-ready');
    showSlide(0);
  }

  /* ---------------------------------------------------------- search */
  var header = doc.querySelector('[data-site-header]');
  var searchToggle = doc.querySelector('[data-search-toggle]');
  var panel = doc.getElementById('site-search-panel');
  var input = doc.getElementById('site-search-input');
  var results = doc.getElementById('site-search-results');
  var status = doc.querySelector('.header-search__status');
  var index = null;
  var loading = null;
  var activeIndex = -1;

  function setStatus(text) {
    if (status) status.textContent = text;
  }

  function normalize(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function loadIndex() {
    if (index) return Promise.resolve(index);
    if (loading) return loading;
    setStatus('Loading search index…');
    loading = fetch('/search.json', { credentials: 'same-origin' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        if (!Array.isArray(data)) throw new Error('Invalid search index');
        index = data.map(function (entry) {
          return {
            entry: entry,
            title: normalize(entry.title),
            tags: normalize(entry.tags),
            description: normalize(entry.description)
          };
        });
        setStatus('');
        return index;
      })
      .catch(function (error) {
        loading = null;
        setStatus('Search is unavailable right now.');
        throw error;
      });
    return loading;
  }

  function scoreItem(item, words) {
    var score = 0;
    for (var i = 0; i < words.length; i++) {
      var word = words[i];
      var hit = 0;
      if (item.title.indexOf(word) !== -1) hit += item.title.indexOf(word) === 0 ? 7 : 5;
      if (item.tags.indexOf(word) !== -1) hit += 3;
      if (item.description.indexOf(word) !== -1) hit += 1;
      if (!hit) return 0; /* every word must match somewhere */
      score += hit;
    }
    return score;
  }

  function rank(query) {
    var words = normalize(query).split(' ').filter(Boolean);
    if (!words.length) return [];
    return index
      .map(function (item) { return { item: item, score: scoreItem(item, words) }; })
      .filter(function (x) { return x.score > 0; })
      .sort(function (a, b) {
        return b.score - a.score || String(b.item.entry.date).localeCompare(String(a.item.entry.date));
      })
      .slice(0, 8)
      .map(function (x) { return x.item.entry; });
  }

  function render(list, query) {
    results.innerHTML = '';
    activeIndex = -1;
    if (!query.trim()) { setStatus(''); return; }
    if (!list.length) { setStatus('No posts match “' + query.trim() + '”.'); return; }
    setStatus(list.length + (list.length === 1 ? ' result' : ' results') + ' — use ↑ ↓ and Enter');
    list.forEach(function (entry) {
      var li = doc.createElement('li');
      var a = doc.createElement('a');
      a.href = entry.url;
      var title = doc.createElement('span');
      title.className = 'header-search__title';
      title.textContent = entry.title;
      var meta = doc.createElement('span');
      meta.className = 'header-search__meta';
      meta.textContent = [entry.type, entry.date_label || entry.date].filter(Boolean).join(' · ');
      a.appendChild(title);
      a.appendChild(meta);
      li.appendChild(a);
      results.appendChild(li);
    });
  }

  function openSearch() {
    panel.hidden = false;
    searchToggle.setAttribute('aria-expanded', 'true');
    if (header) header.classList.remove('site-header--hidden');
    input.focus();
    loadIndex().catch(function () { /* status already shown */ });
  }

  function closeSearch() {
    panel.hidden = true;
    searchToggle.setAttribute('aria-expanded', 'false');
  }

  if (searchToggle && panel && input && results) {
    var debounce;
    searchToggle.addEventListener('click', function () {
      if (panel.hidden) openSearch(); else closeSearch();
    });
    input.addEventListener('input', function () {
      clearTimeout(debounce);
      var query = input.value;
      debounce = setTimeout(function () {
        loadIndex().then(function () { render(rank(query), query); }).catch(function () {});
      }, 120);
    });
    if (input.form) {
      input.form.addEventListener('submit', function (event) {
        event.preventDefault();
        var target = results.querySelector('li.is-active a') || results.querySelector('a');
        if (target) window.location.href = target.href;
      });
    }
    doc.addEventListener('keydown', function (event) {
      var typing = /^(input|textarea|select)$/i.test((doc.activeElement || {}).tagName || '');
      if (event.key === 'Escape' && !panel.hidden) {
        closeSearch();
        searchToggle.focus();
      } else if (event.key === '/' && panel.hidden && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        openSearch();
      } else if (!panel.hidden && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        var items = results.querySelectorAll('li');
        if (!items.length) return;
        event.preventDefault();
        activeIndex = (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items.forEach(function (li, i) { li.classList.toggle('is-active', i === activeIndex); });
      }
    });
  }

  /* ---------------------------------------------------------- auto-hiding header */
  if (header) {
    var lastY = window.pageYOffset || 0;
    var ticking = false;
    function onScroll() {
      var y = window.pageYOffset || 0;
      var searchOpen = panel && !panel.hidden;
      if (!searchOpen) {
        if (y > lastY + 4 && y > 180) header.classList.add('site-header--hidden');
        else if (y < lastY - 4 || y <= 180) header.classList.remove('site-header--hidden');
      }
      lastY = y;
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; window.requestAnimationFrame(onScroll); }
    }, { passive: true });
  }

  /* ---------------------------------------------------------- archive filters */
  var topicGroup = doc.querySelector('.blog-topics');
  var entries = doc.querySelectorAll('[data-blog-type]');
  if (topicGroup && entries.length) {
    var pills = topicGroup.querySelectorAll('[data-topic]');
    var typeBoxes = doc.querySelectorAll('[data-blog-filter]');
    var count = doc.querySelector('[data-blog-count]');
    var sections = doc.querySelectorAll('[data-blog-year]');
    var state = { topic: '' };

    function readUrl() {
      var params = new URLSearchParams(window.location.search);
      state.topic = params.get('topic') || '';
      var hidden = (params.get('hide') || '').split(',').filter(Boolean);
      typeBoxes.forEach(function (box) {
        box.checked = hidden.indexOf(box.getAttribute('data-blog-filter')) === -1;
      });
    }

    function writeUrl() {
      var params = new URLSearchParams();
      if (state.topic) params.set('topic', state.topic);
      var hidden = [];
      typeBoxes.forEach(function (box) {
        if (!box.checked) hidden.push(box.getAttribute('data-blog-filter'));
      });
      if (hidden.length) params.set('hide', hidden.join(','));
      var query = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (query ? '?' + query : '') + window.location.hash);
    }

    function applyFilters() {
      var allowed = {};
      typeBoxes.forEach(function (box) { allowed[box.getAttribute('data-blog-filter')] = box.checked; });
      var shown = 0;
      entries.forEach(function (entry) {
        var topics = (entry.getAttribute('data-blog-topics') || '').split(' ');
        var type = entry.getAttribute('data-blog-type');
        var visible = (!state.topic || topics.indexOf(state.topic) !== -1) && allowed[type] !== false;
        entry.hidden = !visible;
        if (visible) shown++;
      });
      sections.forEach(function (section) {
        section.hidden = !section.querySelector('[data-blog-type]:not([hidden])');
      });
      pills.forEach(function (pill) {
        var on = (pill.getAttribute('data-topic') || '') === state.topic;
        pill.classList.toggle('is-active', on);
        pill.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      if (count) count.textContent = shown + (shown === 1 ? ' entry shown.' : ' entries shown.');
    }

    pills.forEach(function (pill) {
      pill.addEventListener('click', function () {
        state.topic = pill.getAttribute('data-topic') || '';
        writeUrl();
        applyFilters();
      });
    });
    typeBoxes.forEach(function (box) {
      box.addEventListener('change', function () { writeUrl(); applyFilters(); });
    });
    readUrl();
    applyFilters();
  }

  /* ---------------------------------------------------------- post: contents list follows the reading position */
  var tocLinks = doc.querySelectorAll('.article-toc a[href^="#"]');
  if (tocLinks.length) {
    var sections = [];
    tocLinks.forEach(function (link) {
      var heading = doc.getElementById(decodeURIComponent(link.getAttribute('href').slice(1)));
      if (heading) sections.push({ heading: heading, link: link });
    });
    var spyQueued = false;
    function markCurrent() {
      var current = sections[0];
      for (var i = 0; i < sections.length; i++) {
        if (sections[i].heading.getBoundingClientRect().top <= 130) current = sections[i];
        else break;
      }
      sections.forEach(function (s) { s.link.classList.toggle('is-active', s === current); });
      spyQueued = false;
    }
    if (sections.length) {
      window.addEventListener('scroll', function () {
        if (!spyQueued) { spyQueued = true; window.requestAnimationFrame(markCurrent); }
      }, { passive: true });
      markCurrent();
    }
  }

  /* ---------------------------------------------------------- post: copy buttons */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var area = doc.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      doc.body.appendChild(area);
      area.select();
      var ok = false;
      try { ok = doc.execCommand('copy'); } catch (e) { ok = false; }
      doc.body.removeChild(area);
      if (ok) resolve(); else reject(new Error('copy failed'));
    });
  }

  function flash(node, text, original) {
    node.textContent = text;
    window.setTimeout(function () { node.textContent = original; }, 1600);
  }

  doc.querySelectorAll('.code-block').forEach(function (block) {
    var code = block.querySelector('pre code');
    if (!code) return;
    var button = doc.createElement('button');
    var label = doc.createElement('span');
    button.type = 'button';
    button.className = 'code-copy';
    button.setAttribute('aria-label', 'Copy this code');
    label.textContent = 'Copy';
    button.appendChild(label);
    button.addEventListener('click', function () {
      copyText(code.textContent).then(
        function () { flash(label, 'Copied', 'Copy'); },
        function () { flash(label, 'Select and copy', 'Copy'); }
      );
    });
    block.appendChild(button);
  });

  doc.querySelectorAll('[data-copy-link]').forEach(function (button) {
    var original = button.textContent;
    button.hidden = false;
    var dot = doc.querySelector('[data-copy-link-dot]');
    if (dot) dot.hidden = false;
    button.addEventListener('click', function () {
      copyText(button.getAttribute('data-copy-link')).then(
        function () { flash(button, 'Link copied', original); },
        function () { flash(button, 'Copy failed', original); }
      );
    });
  });

  /* ---------------------------------------------------------- post: click a figure to enlarge it */
  var figures = doc.querySelectorAll('.post-figure__zoom');
  if (figures.length) {
    var box = doc.createElement('div');
    var big = doc.createElement('img');
    var closeButton = doc.createElement('button');
    var opener = null;
    box.className = 'lightbox';
    box.hidden = true;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Enlarged figure');
    closeButton.type = 'button';
    closeButton.className = 'lightbox__close';
    closeButton.setAttribute('aria-label', 'Close the enlarged figure');
    closeButton.textContent = '×';
    box.appendChild(big);
    box.appendChild(closeButton);
    doc.body.appendChild(box);

    function closeBox() {
      box.hidden = true;
      root.style.overflow = '';
      if (opener) opener.focus();
    }
    box.addEventListener('click', closeBox);
    doc.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !box.hidden) closeBox();
    });
    figures.forEach(function (link) {
      link.addEventListener('click', function (event) {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return; /* let "open in new tab" work */
        var img = link.querySelector('img');
        event.preventDefault();
        opener = link;
        big.src = link.getAttribute('href');
        big.alt = img ? img.alt : '';
        box.hidden = false;
        root.style.overflow = 'hidden';
        closeButton.focus();
      });
    });
  }
})();
