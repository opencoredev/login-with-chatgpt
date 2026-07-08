(() => {
  const trackedLinks = [
    {
      event: "hero_quickstart_clicked",
      href: "/docs/quickstart",
      text: "Get started",
      surface: "home_hero",
    },
    {
      event: "hero_docs_clicked",
      href: "/docs",
      text: "Read the docs",
      surface: "home_hero",
    },
    {
      event: "security_model_clicked",
      href: "/docs/concepts/security",
      surface: "home_security",
    },
    {
      event: "github_clicked",
      href: "https://github.com/opencoredev/login-with-chatgpt",
      surface: "site_nav",
    },
    {
      event: "llms_txt_clicked",
      href: "/llms.txt",
      surface: "home_footer",
    },
    {
      event: "chat_app_guide_clicked",
      href: "/docs/guides/chat-app",
      surface: "docs_navigation",
    },
    {
      event: "production_checklist_clicked",
      href: "/docs/guides/production",
      surface: "docs_navigation",
    },
  ];

  function normalizePath(url) {
    try {
      const parsed = new URL(url, window.location.origin);
      return parsed.origin === window.location.origin
        ? parsed.pathname
        : parsed.href;
    } catch {
      return url;
    }
  }

  function linkText(link) {
    return (link.textContent || link.getAttribute("aria-label") || "").trim();
  }

  document.addEventListener(
    "click",
    (event) => {
      const link =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;

      if (!link) return;

      const href = normalizePath(link.getAttribute("href") || "");
      const text = linkText(link);
      const match = trackedLinks.find((tracked) => {
        if (tracked.href !== href) return false;
        return !tracked.text || tracked.text === text;
      });

      if (!match || !window.stonks) return;

      window.stonks.event(match.event, window.location.pathname, {
        href: href,
        text: text,
        surface: match.surface,
      });
    },
    { capture: true },
  );
})();
