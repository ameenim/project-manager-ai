// Runs first in the head of the home page. It lives in a file so the page needs no inline script, which lets the
// Content Security Policy refuse every inline script.
document.documentElement.classList.add('js'); document.documentElement.lang = 'en';
