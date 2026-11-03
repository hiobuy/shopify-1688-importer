import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { Editor, AiCapability } from "../lib/schema";
import type { SourceProduct } from "../lib/products";
import { calculatePrice } from "../lib/pricing";
import type { ClientJob } from "./jobs";
import { RichText } from "./rich-text";
import { Badge, Modal, ProductImage } from "./ui";
export interface PanelProps {
  editor: Editor;
  source: SourceProduct;
  update: (next: Editor) => void;
  disabled: boolean;
  runAi: (capability: AiCapability, imageId?: string) => void;
  runImageTools?: (imageIds: string[], tools: AiCapability[]) => void;
  jobs?: ClientJob[];
  pendingImageIds?: string[];
  credits?: number | null;
  applyImage?: (job: ClientJob, replace: boolean) => void;
  collections: { id: string; title: string }[];
  upload: (file: File) => Promise<void>;
  uploading: boolean;
}
export function ProductPanel({
  editor,
  source,
  update,
  disabled,
  runAi,
  collections,
}: PanelProps) {
  const hero = editor.images.find((i) => i.selected);
  const [tagsInput, setTagsInput] = useState(editor.tags.join(", "));
  return (
    <div className="editor-product">
      <div>
        <ProductImage
          className="editor-hero"
          src={hero?.url || ""}
          alt={editor.title}
        />
        <div className="thumbs">
          {editor.images
            .filter((i) => i.selected)
            .slice(0, 4)
            .map((i) => (
              <ProductImage key={i.id} src={i.url} alt={i.alt} />
            ))}
        </div>
        <div className="source-title">
          <span className="eyebrow">ORIGINAL TITLE</span>
          <p>{source.title.original}</p>
        </div>
        {source.source_url && (
          <a href={source.source_url} target="_blank" rel="noreferrer">
            View on 1688 ↗
          </a>
        )}
      </div>
      <fieldset disabled={disabled}>
        <div className="section-heading">
          <h2>Product information</h2>
          <button
            className="ai compact"
            onClick={() => runAi("title_translation")}
          >
            ✧ Translate title
          </button>
        </div>
        <label>
          Shopify title
          <input
            maxLength={255}
            value={editor.title}
            onChange={(e) => update({ ...editor, title: e.target.value })}
          />
          <small>A clear title helps customers find your product.</small>
        </label>
        <div className="two-col">
          <label>
            Product type
            <input
              value={editor.productType}
              onChange={(e) =>
                update({ ...editor, productType: e.target.value })
              }
            />
          </label>
          <label>
            Vendor
            <input
              value={editor.vendor}
              onChange={(e) => update({ ...editor, vendor: e.target.value })}
            />
          </label>
        </div>
        <label>
          Collections
          <select
            multiple
            value={editor.collections}
            onChange={(e) =>
              update({
                ...editor,
                collections: Array.from(
                  e.target.selectedOptions,
                  (o) => o.value,
                ),
              })
            }
          >
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          <small>
            Choose manual collections. Hold ⌘ / Ctrl to select more than one.
          </small>
        </label>
        <label>
          Tags
          <input
            value={tagsInput}
            onChange={(e) => {
              setTagsInput(e.target.value);
              update({
                ...editor,
                tags: e.target.value
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean),
              });
            }}
          />
          <small>Separate tags with commas.</small>
        </label>
        <label>
          SEO description
          <textarea
            maxLength={320}
            rows={3}
            value={editor.seoDescription}
            onChange={(e) =>
              update({ ...editor, seoDescription: e.target.value })
            }
          />
          <small>
            Write this yourself. Commerce AI V1 has no SEO generator.
          </small>
        </label>
        <p className="muted-box">
          Title translation uses Commerce AI Credits and needs confirmation
          before it changes this draft. You can edit every field manually and
          import without AI.
        </p>
      </fieldset>
    </div>
  );
}
export function DescriptionPanel({
  editor,
  source,
  update,
  disabled,
  runAi,
}: PanelProps) {
  const [original, setOriginal] = useState(false);
  return (
    <fieldset disabled={disabled}>
      <div className="section-heading">
        <div>
          <h2>Tell the product’s story</h2>
          <p className="muted">
            Turn supplier information into customer-friendly copy.
          </p>
        </div>
        <button
          className="ai compact"
          onClick={() => runAi("description_translation")}
        >
          ✧ Translate description
        </button>
      </div>
      <RichText
        value={editor.descriptionHtml}
        disabled={disabled}
        onChange={(descriptionHtml) => update({ ...editor, descriptionHtml })}
      />
      <div className="row">
        <button onClick={() => setOriginal(true)}>
          View original description
        </button>
      </div>
      <div className="section-heading divider">
        <h2>Product attributes</h2>
        <button
          className="ai compact"
          onClick={() => runAi("attribute_translation")}
        >
          ✧ Translate attributes
        </button>
      </div>
      <div className="attribute-list">
        {editor.attributes.map((a, i) => (
          <div className="attribute-row" key={i}>
            <input
              aria-label={`Attribute ${i + 1} name`}
              placeholder="Name"
              value={a.name}
              onChange={(e) =>
                update({
                  ...editor,
                  attributes: editor.attributes.map((v, j) =>
                    j === i ? { ...v, name: e.target.value } : v,
                  ),
                })
              }
            />
            <input
              aria-label={`Attribute ${i + 1} value`}
              placeholder="Value"
              value={a.value}
              onChange={(e) =>
                update({
                  ...editor,
                  attributes: editor.attributes.map((v, j) =>
                    j === i ? { ...v, value: e.target.value } : v,
                  ),
                })
              }
            />
            <button
              className="icon-button"
              aria-label={`Remove attribute ${i + 1}`}
              onClick={() =>
                update({
                  ...editor,
                  attributes: editor.attributes.filter((_, j) => j !== i),
                })
              }
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        className="compact"
        onClick={() =>
          update({
            ...editor,
            attributes: [...editor.attributes, { name: "", value: "" }],
          })
        }
      >
        ＋ Add attribute
      </button>
      <details className="original-attributes">
        <summary>Original product attributes</summary>
        <dl className="facts">
          {source.attributes?.map((a, i) => (
            <div key={i}>
              <dt>{a.original_name || a.name}</dt>
              <dd>{a.original_value || a.value}</dd>
            </div>
          ))}
        </dl>
      </details>
      {original && (
        <Modal
          title="Original supplier description"
          onClose={() => setOriginal(false)}
          footer={
            <>
              <button onClick={() => setOriginal(false)}>Close</button>
              <button
                onClick={() => {
                  update({
                    ...editor,
                    descriptionHtml: source.description?.original || "",
                  });
                  setOriginal(false);
                }}
              >
                Use original
              </button>
            </>
          }
        >
          <pre className="original-code">
            {source.description?.original ||
              "The public API did not supply an original description."}
          </pre>
        </Modal>
      )}
    </fieldset>
  );
}
function optionGroups(variants: Editor["variants"]) {
  const groups: { key: string; name: string }[] = [];
  for (const variant of variants)
    for (const option of variant.options)
      if (!groups.some((group) => group.key === option.key))
        groups.push({ key: option.key, name: option.name });
  return groups;
}
function SkuImagePicker({
  variantId,
  imageId,
  images,
  onChange,
}: {
  variantId: string;
  imageId: string | null;
  images: Editor["images"];
  onChange: (imageId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const [place, setPlace] = useState({ top: 0, left: 0 });
  const current = images.find((image) => image.id === imageId);
  const choices = [
    ...images.filter((image) => image.selected),
    ...(current && !current.selected ? [current] : []),
  ];
  useEffect(() => {
    if (!open) return;
    function close(event: MouseEvent) {
      const target = event.target as Node;
      if (button.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".sku-image-menu")) return;
      setOpen(false);
    }
    function dismiss() {
      setOpen(false);
    }
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);
  return (
    <>
      <button
        type="button"
        ref={button}
        className={`sku-image-button${current ? "" : " is-empty"}`}
        aria-label={`SKU ${variantId} image`}
        aria-expanded={open}
        onClick={() => {
          const rect = button.current?.getBoundingClientRect();
          if (!rect) return;
          const width = 248;
          setPlace({
            top: rect.bottom + 6,
            left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
          });
          setOpen((value) => !value);
        }}
      >
        {current ? (
          <ProductImage src={current.url} alt="" />
        ) : (
          <span>Choose</span>
        )}
      </button>
      {open &&
        createPortal(
          <div
            className="sku-image-menu"
            style={{ top: place.top, left: place.left }}
            role="listbox"
            aria-label={`Choose image for SKU ${variantId}`}
          >
            <button
              type="button"
              className={`sku-image-none${imageId ? "" : " is-selected"}`}
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              No image
            </button>
            {choices.map((image, index) => (
              <button
                type="button"
                key={image.id}
                className={image.id === imageId ? "is-selected" : ""}
                aria-label={`Image ${index + 1}`}
                onClick={() => {
                  onChange(image.id);
                  setOpen(false);
                }}
              >
                <ProductImage src={image.url} alt="" />
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
export function VariantsPanel({ editor, update, disabled }: PanelProps) {
  const selected = editor.variants.filter((v) => v.selected).length;
  const groups = optionGroups(editor.variants);
  function renameOption(key: string, name: string) {
    update({
      ...editor,
      variants: editor.variants.map((row) => ({
        ...row,
        options: row.options.map((option) =>
          option.key === key ? { ...option, name } : option,
        ),
      })),
    });
  }
  return (
    <fieldset disabled={disabled}>
      <div className="section-heading">
        <div>
          <h2>Variants & pricing</h2>
          <p className="muted">
            Review source costs and choose your selling prices.
          </p>
        </div>
        <Badge>{selected} selected</Badge>
      </div>
      <div className="pricing-grid">
        <label>
          Sales currency
          <input value={editor.pricing.currency} readOnly />
        </label>
        {editor.pricing.currency !== "CNY" && (
          <label>
            1 CNY = ? {editor.pricing.currency}
            <input
              inputMode="decimal"
              value={editor.pricing.exchangeRate}
              onChange={(e) =>
                update({
                  ...editor,
                  pricing: { ...editor.pricing, exchangeRate: e.target.value },
                })
              }
            />
          </label>
        )}
        <label>
          Price multiplier
          <input
            inputMode="decimal"
            value={editor.pricing.multiplier}
            onChange={(e) =>
              update({
                ...editor,
                pricing: { ...editor.pricing, multiplier: e.target.value },
              })
            }
          />
        </label>
        <label>
          Rounding
          <select
            value={editor.pricing.rounding}
            onChange={(e) =>
              update({
                ...editor,
                pricing: {
                  ...editor.pricing,
                  rounding: e.target.value as Editor["pricing"]["rounding"],
                },
              })
            }
          >
            <option value="two_decimals">Currency precision</option>
            <option value="ending_99">Round up to .99</option>
            <option value="whole">Round up to whole</option>
          </select>
        </label>
      </div>
      <div className="row between wrap">
        <p className="hint">
          Cost × exchange rate × multiplier. These settings override defaults
          for this draft.
        </p>
        <button
          onClick={() =>
            update({
              ...editor,
              variants: editor.variants.map((v) => ({
                ...v,
                price: calculatePrice(v.costCny, editor.pricing),
              })),
            })
          }
        >
          Apply pricing to all SKUs
        </button>
      </div>
      {groups.length > 0 && (
        <div className="option-names">
          <div>
            <h3>Option names</h3>
            <p className="hint">
              These names are shared by every variant, such as Color or Size.
              Change a name once here. Each row below only edits that variant’s
              value.
            </p>
          </div>
          <div className="option-name-fields">
            {groups.map((group, index) => (
              <label key={group.key}>
                Option {index + 1}
                <input
                  aria-label={`Option ${index + 1} name`}
                  value={group.name}
                  onChange={(event) => renameOption(group.key, event.target.value)}
                />
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="table-scroll variant-table">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Select all variants"
                  checked={selected === editor.variants.length}
                  onChange={(e) =>
                    update({
                      ...editor,
                      variants: editor.variants.map((v) => ({
                        ...v,
                        selected: e.target.checked,
                      })),
                    })
                  }
                />
              </th>
              <th>Variant</th>
              <th>SKU</th>
              <th>Image</th>
              <th>Cost · CNY</th>
              <th>Stock</th>
              <th>Price · {editor.pricing.currency}</th>
            </tr>
          </thead>
          <tbody>
            {editor.variants.map((v, i) => (
              <tr key={v.id} className={v.selected ? "" : "excluded"}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select SKU ${v.id}`}
                    checked={v.selected}
                    onChange={(e) =>
                      update({
                        ...editor,
                        variants: editor.variants.map((row, j) =>
                          j === i
                            ? { ...row, selected: e.target.checked }
                            : row,
                        ),
                      })
                    }
                  />
                </td>
                <td>
                  {v.options.length ? (
                    v.options.map((o, k) => (
                      <label className="variant-value" key={o.key}>
                        <span>{o.name}</span>
                        <input
                          aria-label={`SKU ${v.id} option ${k + 1} value`}
                          value={o.value}
                          onChange={(e) =>
                            update({
                              ...editor,
                              variants: editor.variants.map((row, j) =>
                                j === i
                                  ? {
                                      ...row,
                                      options: row.options.map((option, l) =>
                                        l === k
                                          ? { ...option, value: e.target.value }
                                          : option,
                                      ),
                                    }
                                  : row,
                              ),
                            })
                          }
                        />
                      </label>
                    ))
                  ) : (
                    <span className="muted">Default title</span>
                  )}
                </td>
                <td>
                  <input
                    aria-label={`SKU code ${v.id}`}
                    value={v.sku}
                    onChange={(e) =>
                      update({
                        ...editor,
                        variants: editor.variants.map((row, j) =>
                          j === i ? { ...row, sku: e.target.value } : row,
                        ),
                      })
                    }
                  />
                </td>
                <td>
                  <SkuImagePicker
                    variantId={v.id}
                    imageId={v.imageId}
                    images={editor.images}
                    onChange={(imageId) =>
                      update({
                        ...editor,
                        variants: editor.variants.map((row, j) =>
                          j === i ? { ...row, imageId } : row,
                        ),
                      })
                    }
                  />
                </td>
                <td>
                  {v.costCny === null
                    ? "Not supplied"
                    : `¥${v.costCny.toFixed(2)}`}
                </td>
                <td>{v.stock ?? "—"}</td>
                <td>
                  <input
                    className="price-input"
                    aria-label={`Shopify price ${v.id}`}
                    inputMode="decimal"
                    value={v.price}
                    onChange={(e) =>
                      update({
                        ...editor,
                        variants: editor.variants.map((row, j) =>
                          j === i ? { ...row, price: e.target.value } : row,
                        ),
                      })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        Shopify uses the store’s base currency. Supplier stock is informational;
        imported variants use untracked inventory. Up to 3 options and 100
        selected SKUs per import.
      </p>
    </fieldset>
  );
}
const imageTools: { id: AiCapability; label: string; icon: ReactNode }[] = [
  {
    id: "image_text",
    label: "Erase Chinese text",
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M8 1.5 8.9 6.1 13.5 7 8.9 7.9 8 12.5 7.1 7.9 2.5 7 7.1 6.1 8 1.5Z"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: "image_translation",
    label: "Translate image text",
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M2 3.5h6M5 2v1.5M3.5 3.5c.5 2.5 2 4 4 5M6.5 3.5c-.4 2.6-1.9 4.4-4 5.5"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
        <path
          d="m8.5 14 2.5-6 2.5 6M9.3 12h3.4"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: "image_background",
    label: "White background",
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect
          x="2.5"
          y="3.5"
          width="11"
          height="9"
          rx="1.2"
          stroke="currentColor"
          strokeWidth="1.25"
        />
        <path
          d="M5 11.5 7.2 8.8l1.6 1.6L11.5 7"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];
const viewIcon = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
    <rect
      x="2.5"
      y="2.5"
      width="11"
      height="11"
      rx="1.5"
      stroke="currentColor"
      strokeWidth="1.25"
    />
    <circle cx="6" cy="6.2" r="1.1" fill="currentColor" />
    <path
      d="m3 12 3.3-3.3 2 2L10.5 8.5 13 11"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinejoin="round"
    />
  </svg>
);
const deleteIcon = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path
      d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
function TipButton({
  tip,
  children,
  ...props
}: { tip: string; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <span className="studio-tip" data-tip={tip}>
      <button type="button" {...props}>
        {children}
      </button>
    </span>
  );
}
function canUseAi(image: Editor["images"][number]) {
  return [image.aiSourceUrl, image.url, image.originalUrl].some(
    (value) =>
      !!value &&
      value.startsWith("https://") &&
      !value.includes("/app/api/assets/"),
  );
}
function ImageCompare({ before, after }: { before: string; after: string }) {
  const [pos, setPos] = useState(50);
  const [ratio, setRatio] = useState<number | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  function move(clientX: number) {
    const rect = frame.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    setPos(
      Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)),
    );
  }
  return (
    <div
      className="img-compare"
      ref={frame}
      style={{
        aspectRatio: ratio ? `${ratio}` : "1",
        width: `min(100%, calc(min(72vh, 760px) * ${ratio || 1}))`,
        height: "min(72vh, 760px)",
      }}
      role="slider"
      tabIndex={0}
      aria-label="Compare the supplier image and the AI result. Drag left or right."
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pos)}
      onPointerDown={(event) => {
        frame.current?.setPointerCapture(event.pointerId);
        move(event.clientX);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          move(event.clientX);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          setPos((current) => Math.max(0, current - 4));
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          setPos((current) => Math.min(100, current + 4));
        }
      }}
    >
      <ProductImage
        src={after}
        alt="AI result"
        onLoad={(image) => {
          if (image.naturalWidth > 0 && image.naturalHeight > 0)
            setRatio(image.naturalWidth / image.naturalHeight);
        }}
      />
      <div
        className="img-compare-before"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
      >
        <ProductImage src={before} alt="Supplier original" />
      </div>
      <span className="img-compare-handle" style={{ left: `${pos}%` }}>
        <span className="img-compare-knob" aria-hidden>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <path
              d="M9 5.5 4.5 11 9 16.5M13 5.5 17.5 11 13 16.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </span>
      <span className="img-compare-label before">Before</span>
      <span className="img-compare-label after">After</span>
    </div>
  );
}
export function ImagesPanel({
  editor,
  update,
  disabled,
  runImageTools,
  runAi,
  jobs = [],
  pendingImageIds = [],
  credits,
  applyImage,
  upload,
  uploading,
}: PanelProps) {
  const [viewing, setViewing] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const bulk = useRef<HTMLDivElement>(null);
  const selectAll = useRef<HTMLInputElement>(null);
  const images = editor.images;
  const chosen = images.filter((i) => i.selected);
  const cover = chosen[0]?.id;
  const viewed = images.find((i) => i.id === viewing);
  useEffect(() => {
    if (selectAll.current)
      selectAll.current.indeterminate =
        chosen.length > 0 && chosen.length < images.length;
  });
  useEffect(() => {
    if (!menu) return;
    function close(event: MouseEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (
        event instanceof MouseEvent &&
        bulk.current?.contains(event.target as Node)
      )
        return;
      setMenu(false);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);
  function activeJob(id: string) {
    return jobs.find(
      (job) =>
        job.imageId === id &&
        (job.status === "QUEUED" || job.status === "RUNNING"),
    );
  }
  function reviewJob(id: string) {
    return jobs.find(
      (job) =>
        job.imageId === id &&
        job.status === "SUCCEEDED" &&
        !job.applied &&
        !job.simulated &&
        !!job.result?.imageUrl,
    );
  }
  function isBusy(id: string) {
    return pendingImageIds.includes(id) || !!activeJob(id) || !!reviewJob(id);
  }
  function run(ids: string[], tool: AiCapability) {
    const ready = ids.filter((id) => !isBusy(id));
    if (!ready.length) return;
    if (runImageTools) runImageTools(ready, [tool]);
    else ready.forEach((id) => runAi(tool, id));
  }
  function setSelected(ids: string[], selected: boolean) {
    update({
      ...editor,
      images: images.map((i) => (ids.includes(i.id) ? { ...i, selected } : i)),
      variants: selected
        ? editor.variants
        : editor.variants.map((v) =>
            v.imageId && ids.includes(v.imageId) ? { ...v, imageId: null } : v,
          ),
    });
  }
  function patch(id: string, change: Partial<Editor["images"][number]>) {
    update({
      ...editor,
      images: images.map((i) => (i.id === id ? { ...i, ...change } : i)),
    });
  }
  function move(id: string, delta: number) {
    const next = [...images];
    const from = next.findIndex((i) => i.id === id);
    const to = from + delta;
    if (to < 0 || to >= next.length) return;
    [next[from], next[to]] = [next[to], next[from]];
    update({ ...editor, images: next });
  }
  function makeCover(id: string) {
    const image = images.find((i) => i.id === id);
    if (!image) return;
    update({
      ...editor,
      images: [
        { ...image, selected: true },
        ...images.filter((i) => i.id !== id),
      ],
    });
  }
  function remove(id: string) {
    if (viewing === id) setViewing(null);
    setRemoveId(null);
    update({
      ...editor,
      images: images.filter((i) => i.id !== id),
      variants: editor.variants.map((v) =>
        v.imageId === id ? { ...v, imageId: null } : v,
      ),
    });
  }
  function restore(id: string) {
    patch(id, {
      url: images.find((i) => i.id === id)?.originalUrl,
      assetId: undefined,
      aiSourceUrl: undefined,
      mockApplied: false,
    });
  }
  const bulkTargets = chosen
    .filter((i) => canUseAi(i) && !isBusy(i.id))
    .map((i) => i.id);
  return (
    <fieldset disabled={disabled} className="studio">
      <div className="studio-bar">
        <label className="check">
          <input
            ref={selectAll}
            type="checkbox"
            aria-label="Select all images"
            checked={images.length > 0 && chosen.length === images.length}
            onChange={(e) =>
              setSelected(
                images.map((i) => i.id),
                e.target.checked,
              )
            }
          />
          Select all
        </label>
        <span className="studio-count">{chosen.length} selected</span>
        <div className="studio-bulk" ref={bulk}>
          <button
            type="button"
            className="compact"
            aria-haspopup="menu"
            aria-expanded={menu}
            disabled={!chosen.length}
            onClick={() => setMenu((open) => !open)}
          >
            ⚡ Bulk actions ▾
          </button>
          {menu && (
            <div className="studio-menu" role="menu">
              {imageTools.map((tool) => (
                <button
                  type="button"
                  role="menuitem"
                  key={tool.id}
                  disabled={!bulkTargets.length}
                  onClick={() => {
                    setMenu(false);
                    run(bulkTargets, tool.id);
                  }}
                >
                  {tool.icon}
                  <span>{tool.label}</span>
                  <small>{bulkTargets.length}</small>
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  setSelected(
                    images.map((i) => i.id),
                    false,
                  );
                }}
              >
                <span>Clear selection</span>
              </button>
            </div>
          )}
        </div>
        <span className="studio-spacer" />
        {credits != null && (
          <span className="studio-credits">
            {credits.toLocaleString()} AI credits remaining
          </span>
        )}
        <label className="button upload-button">
          {uploading ? "Uploading…" : "↑ Upload images"}
          <input
            hidden
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <p className="hint">
        Hover an image for AI tools. Click a finished image to compare it, then
        confirm the replacement. Checked images are imported, and the first one
        is the cover.
      </p>
      <div className="studio-grid">
        {images.map((image, index) => {
          const active = activeJob(image.id);
          const review = !active ? reviewJob(image.id) : undefined;
          const pending = !active && !review && pendingImageIds.includes(image.id);
          const latest = jobs.find((job) => job.imageId === image.id);
          const failed =
            !active && !pending && !review && latest?.status === "FAILED"
              ? latest
              : null;
          const changed = image.url !== image.originalUrl && !image.mockApplied;
          const aiReady = canUseAi(image) && !review;
          const toolName =
            imageTools.find((tool) => tool.id === active?.capability)?.label ||
            "AI";
          const [status, tone] =
            active || pending
              ? ["Processing", "busy"]
              : review
                ? ["Review", "review"]
                : failed
                  ? ["Failed", "error"]
                  : image.mockApplied
                    ? ["Simulated", "info"]
                    : changed
                      ? ["Applied", "done"]
                      : ["Not processed", ""];
          return (
            <article
              className={`studio-card${image.selected ? " is-selected" : " is-excluded"}${active || pending ? " is-processing" : ""}`}
              key={image.id}
            >
              <div className="studio-frame">
                <button
                  type="button"
                  className="studio-thumb"
                  aria-label={`View image ${index + 1}`}
                  onClick={() => setViewing(image.id)}
                >
                  <ProductImage
                    src={image.url}
                    alt={image.alt || "Product image"}
                  />
                </button>
                {image.id === cover && (
                  <span className="studio-cover-tag">Cover</span>
                )}
                <label className="studio-check">
                  <input
                    type="checkbox"
                    aria-label={`Select image ${index + 1}`}
                    checked={image.selected}
                    onChange={(e) => setSelected([image.id], e.target.checked)}
                  />
                </label>
                {images.length > 1 && !active && !pending && (
                  <>
                    <button
                      type="button"
                      className="studio-move left"
                      disabled={index === 0}
                      onClick={() => move(image.id, -1)}
                      aria-label={`Move image ${index + 1} earlier`}
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      className="studio-move right"
                      disabled={index === images.length - 1}
                      onClick={() => move(image.id, 1)}
                      aria-label={`Move image ${index + 1} later`}
                    >
                      ›
                    </button>
                  </>
                )}
                {image.mockApplied && (
                  <span className="mock-watermark">MOCK · original pixels</span>
                )}
                {active || pending ? (
                  <div className="img-busy" aria-busy="true">
                    <span className="img-spinner" />
                    <strong>{pending ? "Queued" : toolName}</strong>
                    <small>
                      {pending
                        ? "Starting…"
                        : active?.error
                          ? active.error
                          : "Working…"}
                    </small>
                  </div>
                ) : review ? (
                  <div
                    className="studio-tools is-review"
                    role="toolbar"
                    aria-label={`Image ${index + 1} tools`}
                  >
                    <TipButton
                      tip="View"
                      aria-label={`View image ${index + 1}`}
                      onClick={() => setViewing(image.id)}
                    >
                      {viewIcon}
                    </TipButton>
                    <button
                      type="button"
                      className="studio-confirm"
                      onClick={() => setViewing(image.id)}
                    >
                      Confirm
                    </button>
                    <TipButton
                      className="danger"
                      tip="Remove"
                      aria-label={`Remove image ${index + 1}`}
                      onClick={() => setRemoveId(image.id)}
                    >
                      {deleteIcon}
                    </TipButton>
                  </div>
                ) : (
                  <div
                    className="studio-tools"
                    role="toolbar"
                    aria-label={`Image ${index + 1} tools`}
                  >
                    <TipButton
                      tip="View"
                      aria-label={`View image ${index + 1}`}
                      onClick={() => setViewing(image.id)}
                    >
                      {viewIcon}
                    </TipButton>
                    {imageTools.map((tool) => (
                      <TipButton
                        key={tool.id}
                        tip={
                          aiReady
                            ? tool.label
                            : "Uploaded images cannot be sent to Commerce AI"
                        }
                        aria-label={`${tool.label} on image ${index + 1}`}
                        disabled={!aiReady}
                        onClick={() => run([image.id], tool.id)}
                      >
                        {tool.icon}
                      </TipButton>
                    ))}
                    <TipButton
                      className="danger"
                      tip="Remove"
                      aria-label={`Remove image ${index + 1}`}
                      onClick={() => setRemoveId(image.id)}
                    >
                      {deleteIcon}
                    </TipButton>
                  </div>
                )}
              </div>
              <div className="studio-meta">
                <span className={`studio-status ${tone}`}>{status}</span>
                <span className="studio-order">
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>
              <div className="studio-links">
                {image.id === cover ? (
                  <span className="studio-cover-link">Main cover</span>
                ) : (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => makeCover(image.id)}
                  >
                    Set cover
                  </button>
                )}
                {review && (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setViewing(image.id)}
                  >
                    Review
                  </button>
                )}
                {failed && (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => run([image.id], failed.capability)}
                  >
                    Retry
                  </button>
                )}
                {(changed || image.mockApplied) && !active && !pending && !review && (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => restore(image.id)}
                  >
                    Restore
                  </button>
                )}
              </div>
              {failed?.error && (
                <p className="studio-error" title={failed.error}>
                  {failed.error}
                </p>
              )}
            </article>
          );
        })}
      </div>
      {viewed && (
        <Modal
          title={reviewJob(viewed.id) ? "Compare and replace" : "Image details"}
          wide
          onClose={() => setViewing(null)}
          footer={
            reviewJob(viewed.id) ? (
              <>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    const job = reviewJob(viewed.id);
                    if (!job) return;
                    applyImage?.(job, false);
                    setViewing(null);
                  }}
                >
                  Keep original
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={disabled}
                  onClick={() => {
                    const job = reviewJob(viewed.id);
                    if (!job) return;
                    applyImage?.(job, true);
                    setViewing(null);
                  }}
                >
                  Replace image
                </button>
              </>
            ) : undefined
          }
        >
          {reviewJob(viewed.id)?.result?.imageUrl ? (
            <div className="compare-stage">
              <ImageCompare
                before={viewed.url}
                after={reviewJob(viewed.id)!.result!.imageUrl!}
              />
            </div>
          ) : viewed.url !== viewed.originalUrl ? (
            <div className="compare-stage">
              <ImageCompare before={viewed.originalUrl} after={viewed.url} />
            </div>
          ) : (
            <ProductImage
              className="original-image"
              src={viewed.url}
              alt={viewed.alt || "Product image"}
            />
          )}
          <p className="hint">
            {reviewJob(viewed.id)
              ? "Drag the handle left or right. Replace image only after it looks right."
              : viewed.url !== viewed.originalUrl
                ? "Drag the handle to compare the supplier image and the current one."
                : "This is the current image."}
          </p>
          <label>
            Alt text
            <input
              value={viewed.alt}
              placeholder="Describe the image for shoppers and search"
              disabled={disabled}
              onChange={(e) => patch(viewed.id, { alt: e.target.value })}
            />
          </label>
        </Modal>
      )}
      {images.some((image) => image.id === removeId) && (
        <Modal
          title="Remove this image?"
          onClose={() => setRemoveId(null)}
          footer={
            <>
              <button type="button" onClick={() => setRemoveId(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => removeId && remove(removeId)}
              >
                Remove image
              </button>
            </>
          }
        >
          <p>
            This image will be left out of the import. The picture on 1688 is
            not deleted.
          </p>
        </Modal>
      )}
    </fieldset>
  );
}
