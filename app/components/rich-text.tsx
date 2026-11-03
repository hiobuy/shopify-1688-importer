import { useEffect, useRef, useState } from "react";

const allowed = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "blockquote",
  "a",
  "img",
  "hr",
  "span",
  "div",
]);

function editorHtml(value: string) {
  const doc = new DOMParser().parseFromString(value || "", "text/html");
  function clean(node: Node) {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType !== 1) return;
      const element = child as Element;
      const tag = element.tagName.toLowerCase();
      if (tag === "script" || tag === "style" || tag === "iframe") {
        element.remove();
        return;
      }
      if (!allowed.has(tag)) {
        const parent = element.parentNode;
        const moved = [...element.childNodes];
        moved.forEach((item) => parent?.insertBefore(item, element));
        element.remove();
        moved.forEach((item) => clean(item));
        return;
      }
      [...element.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        const https =
          attr.value.startsWith("https://") && !attr.value.includes(" ");
        const keep =
          (tag === "a" && name === "href" && https) ||
          (tag === "img" && name === "alt") ||
          (tag === "img" && name === "src" && https);
        if (!keep) element.removeAttribute(attr.name);
      });
      if (tag === "img" && element.getAttribute("src"))
        element.setAttribute("referrerpolicy", "no-referrer");
      if (tag === "a" && element.getAttribute("href")) {
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noopener noreferrer");
      }
      clean(element);
    });
  }
  clean(doc.body);
  return doc.body.innerHTML;
}

function command(name: string, value?: string) {
  document.execCommand(name, false, value);
}

export function RichText({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (html: string) => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  const emitted = useRef("");
  const [link, setLink] = useState("");
  const [linking, setLinking] = useState(false);
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!full) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setFull(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [full]);
  useEffect(() => {
    const node = body.current;
    if (!node || value === emitted.current) return;
    const html = editorHtml(value);
    node.innerHTML = html || "<p><br></p>";
    emitted.current = html;
  }, [value]);
  function emit() {
    const node = body.current;
    if (!node) return;
    const html = editorHtml(node.innerHTML);
    if (node.innerHTML !== html) node.innerHTML = html || "<p><br></p>";
    emitted.current = html;
    onChange(html);
  }
  function format(name: string, argument?: string) {
    body.current?.focus();
    command(name, argument);
    emit();
  }
  function addLink() {
    const url = link.trim();
    if (!url.startsWith("https://")) return;
    format("createLink", url);
    setLink("");
    setLinking(false);
  }
  return (
    <div
      className={`rich-text${disabled ? " is-disabled" : ""}${full ? " is-full" : ""}`}
    >
      <div className="rich-toolbar" role="toolbar" aria-label="Formatting">
        <select
          aria-label="Text style"
          defaultValue="p"
          disabled={disabled}
          onChange={(event) => format("formatBlock", event.target.value)}
        >
          <option value="p">Paragraph</option>
          <option value="h2">Heading</option>
          <option value="h3">Subheading</option>
        </select>
        <button
          type="button"
          aria-label="Bold"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => format("bold")}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          aria-label="Italic"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => format("italic")}
        >
          <em>I</em>
        </button>
        <button
          type="button"
          aria-label="Bulleted list"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => format("insertUnorderedList")}
        >
          •≡
        </button>
        <button
          type="button"
          aria-label="Numbered list"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => format("insertOrderedList")}
        >
          1.
        </button>
        <button
          type="button"
          aria-label="Link"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setLinking((open) => !open)}
        >
          Link
        </button>
        <button
          type="button"
          aria-label="Clear formatting"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => format("removeFormat")}
        >
          Clear
        </button>
        <button
          type="button"
          className="rich-full"
          aria-label={full ? "Exit full screen" : "Full screen"}
          aria-pressed={full}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setFull((open) => !open)}
        >
          {full ? "Exit" : "Full screen"}
        </button>
      </div>
      {linking && (
        <div className="rich-link">
          <input
            aria-label="Link address"
            placeholder="https://"
            value={link}
            disabled={disabled}
            onChange={(event) => setLink(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addLink();
              }
            }}
          />
          <button type="button" disabled={disabled} onClick={addLink}>
            Add link
          </button>
        </div>
      )}
      <div
        ref={body}
        className="rich-body"
        role="textbox"
        aria-multiline="true"
        aria-label="Shopify description"
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={emit}
      />
    </div>
  );
}
