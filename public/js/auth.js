// Проверка аутентификации
function checkAuth() {
  const token = localStorage.getItem("token");
  if (!token) {
    window.location.href = "/login.html";
    return;
  }

  // Проверяем валидность токена
  fetch("/api/auth-user-info", {
    headers: { Authorization: "Bearer " + token }
  }).then(res => {
    if (!res.ok) {
      localStorage.removeItem("token");
      window.location.href = "/login.html";
    }
  }).catch(() => {
    localStorage.removeItem("token");
    window.location.href = "/login.html";
  });
}

// Добавляем проверку при загрузке страницы
document.addEventListener("DOMContentLoaded", checkAuth);

// Добавляем проверку при каждом запросе
const originalFetch = window.fetch;
window.fetch = function(url, options = {}) {
  if (url.startsWith('/api/') && url !== '/api/login') {
    const token = localStorage.getItem("token");
    if (!token) {
      window.location.href = "/login.html";
      return Promise.reject("No token");
    }
    options.headers = {
      ...options.headers,
      Authorization: "Bearer " + token
    };
  }
  return originalFetch(url, options);
}; 