import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
export function Banner({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "warning" | "error" | "success";
}) {
  return (
    <div
      className={`banner ${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <span className="banner-icon">
        {tone === "success" ? "✓" : tone === "error" ? "!" : "i"}
      </span>
      <div>{children}</div>
    </div>
  );
}
export function Badge({
  children,
  tone = "",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">⌕</span>
      <h2>{title}</h2>
      <p className="muted">{children}</p>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  footer,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(
    <dialog
      ref={ref}
      className={wide ? "dialog dialog-wide" : "dialog"}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          ×
        </button>
      </header>
      <div className="dialog-body">{children}</div>
      {footer && <footer>{footer}</footer>}
    </dialog>,
    document.body,
  );
}
export function ProductImage({
  src,
  alt,
  className = "",
  onLoad,
}: {
  src: string;
  alt: string;
  className?: string;
  onLoad?: (image: HTMLImageElement) => void;
}) {
  const [local, setLocal] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    setLocal("");
    if (!src.startsWith("/app/api/assets/")) return;
    let active = true;
    let objectUrl = "";
    const controller = new AbortController();
    fetch(src, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setLocal(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);
  const url = src.startsWith("/app/api/assets/") ? local : src;
  return url && !failed ? (
    <img
      className={className}
      src={url}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onLoad={(event) => onLoad?.(event.currentTarget)}
      onError={() => setFailed(true)}
    />
  ) : (
    <div className={`image-placeholder ${className}`} aria-label={alt}>
      {failed ? "Image unavailable" : "No preview"}
    </div>
  );
}
