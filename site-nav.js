// Shared hamburger menu for pages that don't have their own (the two homepages keep theirs).
// Plain script, no build step: <script src="/site-nav.js" defer></script>. Portuguese links under /pt/.
(function () {
  var pt = location.pathname.indexOf('/pt/') === 0;
  var links = pt
    ? [
        ['Início', '/pt/'],
        ['Formação para Equipas', '/pt/team-training.html'],
        ['Formação IA para Empresas', '/pt/formacao-ia-empresas/'],
        ['Claude Training (EN)', '/claude-training/'],
        ['AI Strategy (EN)', '/ai-strategy/'],
        ['Equipa', '/pt/#team'],
      ]
    : [
        ['Home', '/'],
        ['Team Training', '/team-training.html'],
        ['Claude Training', '/claude-training/'],
        ['AI Strategy', '/ai-strategy/'],
        ['Formação IA (PT)', '/pt/formacao-ia-empresas/'],
        ['Team', '/#team'],
      ];
  var lang = pt ? ['🇬🇧 English', '/'] : ['🇵🇹 Português', '/pt/'];

  var css =
    '.cl-burger{position:fixed;top:30px;right:30px;z-index:10001;background:#e9f174;border:3px solid #545454;padding:12px;cursor:pointer;box-shadow:4px 4px 0 rgba(0,0,0,.3);transition:transform .3s ease}' +
    '.cl-burger:hover{transform:scale(1.05)}' +
    '.cl-burger span{display:block;width:30px;height:3px;background:#545454;margin:6px 0;transition:.3s}' +
    '.cl-burger.cl-open span:nth-child(1){transform:rotate(-45deg) translate(-6px,6px)}' +
    '.cl-burger.cl-open span:nth-child(2){opacity:0}' +
    '.cl-burger.cl-open span:nth-child(3){transform:rotate(45deg) translate(-6px,-6px)}' +
    '.cl-menu{position:fixed;top:0;right:-100%;width:300px;max-width:85vw;height:100vh;background:#fff;border-left:5px solid #545454;box-shadow:-5px 0 15px rgba(0,0,0,.2);z-index:10000;padding:100px 40px 40px;transition:right .4s ease;overflow-y:auto;box-sizing:border-box}' +
    '.cl-menu.cl-open{right:0}' +
    '.cl-menu a{display:block;font-family:"Bebas Neue",sans-serif;font-size:1.5rem;color:#545454;text-decoration:none;padding:15px 0;border-bottom:2px solid #FFB4A2;transition:all .3s ease;letter-spacing:1px}' +
    '.cl-menu a:hover{color:#e7583b;padding-left:10px}' +
    '.cl-menu .cl-lang{margin-top:20px;padding-top:20px;border-top:3px solid #e9f174}' +
    '.cl-menu .cl-lang a{font-size:1.2rem;color:#666;border-bottom:none}' +
    '.cl-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;opacity:0;pointer-events:none;transition:opacity .4s ease}' +
    '.cl-overlay.cl-open{opacity:1;pointer-events:all}' +
    '@media (max-width:768px){.cl-burger{top:20px;right:20px;padding:10px}.cl-burger span{width:25px}}';

  function init() {
    if (!document.querySelector('link[href*="Bebas+Neue"]')) {
      var font = document.createElement('link');
      font.rel = 'stylesheet';
      font.href = 'https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap';
      document.head.appendChild(font);
    }
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    var burger = document.createElement('button');
    burger.className = 'cl-burger';
    burger.type = 'button';
    burger.setAttribute('aria-label', pt ? 'Abrir menu' : 'Open menu');
    burger.setAttribute('aria-expanded', 'false');
    burger.innerHTML = '<span></span><span></span><span></span>';

    var menu = document.createElement('nav');
    menu.className = 'cl-menu';
    menu.setAttribute('aria-label', pt ? 'Menu principal' : 'Main menu');
    menu.innerHTML =
      links.map(function (l) { return '<a href="' + l[1] + '">' + l[0] + '</a>'; }).join('') +
      '<div class="cl-lang"><a href="' + lang[1] + '">' + lang[0] + '</a></div>';

    var overlay = document.createElement('div');
    overlay.className = 'cl-overlay';

    function toggle(open) {
      [burger, menu, overlay].forEach(function (el) { el.classList.toggle('cl-open', open); });
      burger.setAttribute('aria-expanded', String(open));
    }
    burger.addEventListener('click', function () { toggle(!menu.classList.contains('cl-open')); });
    overlay.addEventListener('click', function () { toggle(false); });
    menu.addEventListener('click', function (e) { if (e.target.tagName === 'A') toggle(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') toggle(false); });

    document.body.appendChild(overlay);
    document.body.appendChild(menu);
    document.body.appendChild(burger);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
