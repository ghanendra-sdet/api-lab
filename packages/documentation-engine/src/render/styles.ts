/**
 * The stylesheet emitted alongside generated HTML documentation (spec §24).
 *
 * A plain string constant, shipped as `assets/styles.css` for the static-site
 * export and inlined into the single-file variant. There is no CSS framework,
 * no build step, and no external stylesheet link — a generated documentation
 * page has to render correctly when it is opened from a file:// URL on a
 * machine with no network, which is exactly how people read exported docs.
 *
 * Method colours are the same palette `apps/web/src/lib/methodStyles.ts` uses,
 * so an endpoint looks the same in the app and in its own documentation.
 *
 * Light and dark both come from `prefers-color-scheme` rather than a toggle:
 * a toggle needs state, state needs script, and the less script in a
 * documentation page the better.
 */
export const DOCUMENTATION_STYLESHEET = `:root {
  --bg: #ffffff;
  --fg: #171717;
  --muted: #737373;
  --border: #e5e5e5;
  --surface: #fafafa;
  --code-bg: #f5f5f5;
  --accent: #2563eb;
  --warn-bg: #fffbeb;
  --warn-border: #fde68a;
  --warn-fg: #92400e;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0a0a0a;
    --fg: #e5e5e5;
    --muted: #a3a3a3;
    --border: #262626;
    --surface: #141414;
    --code-bg: #171717;
    --accent: #60a5fa;
    --warn-bg: #1c1917;
    --warn-border: #451a03;
    --warn-fg: #fbbf24;
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}

.layout { display: flex; min-height: 100vh; align-items: flex-start; }

nav.sidebar {
  position: sticky;
  top: 0;
  flex: 0 0 260px;
  max-height: 100vh;
  overflow-y: auto;
  padding: 20px 16px;
  border-right: 1px solid var(--border);
  background: var(--surface);
}

nav.sidebar h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 18px 0 8px; }
nav.sidebar ul { list-style: none; margin: 0; padding: 0; }
nav.sidebar li { margin: 2px 0; }
nav.sidebar a { color: var(--fg); text-decoration: none; display: block; padding: 3px 6px; border-radius: 4px; font-size: 13px; }
nav.sidebar a:hover { background: var(--border); }

main { flex: 1 1 auto; padding: 28px 32px; max-width: 900px; min-width: 0; }

h1 { font-size: 28px; margin: 0 0 8px; }
h2 { font-size: 21px; margin: 34px 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
h3 { font-size: 17px; margin: 26px 0 10px; }
h4 { font-size: 14px; margin: 18px 0 6px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }

p { margin: 8px 0; }

code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; }
code { background: var(--code-bg); padding: 1px 5px; border-radius: 3px; }
pre { background: var(--code-bg); padding: 12px; border-radius: 6px; overflow-x: auto; border: 1px solid var(--border); }
pre code { background: none; padding: 0; }

table { border-collapse: collapse; width: 100%; margin: 10px 0; display: block; overflow-x: auto; }
th, td { border: 1px solid var(--border); padding: 6px 9px; text-align: left; font-size: 13px; vertical-align: top; }
th { background: var(--surface); font-weight: 600; }

.method {
  display: inline-block;
  font-weight: 700;
  font-size: 12px;
  padding: 2px 7px;
  border-radius: 4px;
  color: #fff;
  letter-spacing: .03em;
}
.method-get { background: #16a34a; }
.method-post { background: #2563eb; }
.method-put { background: #ea580c; }
.method-patch { background: #9333ea; }
.method-delete { background: #dc2626; }
.method-head, .method-options { background: #64748b; }

.endpoint { border: 1px solid var(--border); border-radius: 8px; padding: 16px 18px; margin: 18px 0; background: var(--surface); }
.endpoint .path { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 14px; margin-left: 8px; }

.badge { display: inline-block; font-size: 11px; padding: 1px 7px; border-radius: 10px; border: 1px solid var(--border); color: var(--muted); background: var(--bg); margin-left: 6px; }
.badge-deprecated { color: #dc2626; border-color: #dc2626; }

.note { background: var(--warn-bg); border: 1px solid var(--warn-border); color: var(--warn-fg); padding: 10px 12px; border-radius: 6px; font-size: 13px; margin: 12px 0; }

.schema-tree { list-style: none; padding-left: 16px; margin: 6px 0; border-left: 1px solid var(--border); }
.schema-tree li { margin: 3px 0; font-size: 13px; }
.schema-ref { color: var(--accent); }

.muted { color: var(--muted); font-size: 13px; }

#search { width: 100%; padding: 7px 9px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--fg); font-size: 13px; }
#search-results { list-style: none; margin: 8px 0 0; padding: 0; }
#search-results li { margin: 2px 0; }
#search-empty { color: var(--muted); font-size: 12px; padding: 4px 6px; }

@media (max-width: 760px) {
  .layout { flex-direction: column; }
  nav.sidebar { position: static; flex: none; width: 100%; max-height: none; border-right: none; border-bottom: 1px solid var(--border); }
  main { padding: 20px 16px; }
}
`;
