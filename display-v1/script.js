
(() => {
  const button = document.querySelector('[data-menu-button]');
  const nav = document.querySelector('[data-nav]');
  if (button && nav) {
    button.addEventListener('click', () => {
      const isOpen = nav.classList.toggle('open');
      button.setAttribute('aria-expanded', String(isOpen));
      button.textContent = isOpen ? '收合導覽' : '網站導覽';
    });
    nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
      nav.classList.remove('open');
      button.setAttribute('aria-expanded', 'false');
      button.textContent = '網站導覽';
    }));
  }
})();
