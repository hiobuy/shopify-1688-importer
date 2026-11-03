import { useRef, useState } from "react";
import {
  Link,
  useNavigate,
  useOutletContext,
  type LoaderFunctionArgs,
} from "react-router";
import { authenticate } from "../shopify.server";
import { api, errorText, parseResponse } from "../lib/client";
import type { ProductSummary, SourceProduct } from "../lib/products";
import { sourcePrice } from "../lib/products";
import { Banner, Badge, Empty, Modal, ProductImage } from "../components/ui";
import { PageHeader } from "../components/chrome";
export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return null;
}
const imageTypes = ["image/jpeg", "image/png", "image/webp"];
const isSourceUrl = (text: string) =>
  /^(https?:\/\/)?([\w-]+\.)*1688\.com\//i.test(text);

export default function Discover() {
  const { settings } = useOutletContext<{
    settings: { keyConfigured: boolean; environment: string };
  }>();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const text = query.trim();
  const mode = file ? "image" : isSourceUrl(text) ? "url" : "keyword";
  const [search, setSearch] = useState<{
    kind: string;
    keyword?: string;
    imageId?: string;
  } | null>(null);
  const [results, setResults] = useState<{
    items: ProductSummary[];
    page: number;
    total: number;
    pageSize: number;
    environment: string;
  } | null>(null);
  const [sort, setSort] = useState("");
  const [busy, setBusy] = useState(false);
  const [detailBusy, setDetailBusy] = useState("");
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<{
    product: SourceProduct;
    environment: string;
  } | null>(null);
  const [creating, setCreating] = useState(false);
  const inFlight = useRef(false);
  function attach(next: File | null) {
    if (preview) URL.revokeObjectURL(preview);
    setFile(next);
    setPreview(next ? URL.createObjectURL(next) : "");
    if (fileInput.current) fileInput.current.value = "";
  }
  function pick(files: FileList | null | undefined) {
    const next = Array.from(files || []).find((f) => f.type.startsWith("image/"));
    if (!next) return false;
    if (!imageTypes.includes(next.type) || next.size > 4 * 1024 * 1024) {
      setError("Choose a PNG, JPEG or WebP image up to 4 MB.");
      return true;
    }
    setError("");
    attach(next);
    return true;
  }
  async function run(page = 1, nextSort = sort, reuse = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      if (mode === "url" && !reuse) {
        setDetail(
          await api("detail", {
            url: /^https?:\/\//i.test(text) ? text : `https://${text}`,
          }),
        );
        return;
      }
      if ((reuse ? search?.kind : mode) === "image") {
        if (reuse && search?.imageId) {
          const data = await api("imageSearch", {
            imageId: search.imageId,
            page,
            sort: nextSort,
          });
          setResults(data);
        } else {
          if (!file) throw new Error("Choose a product photo first.");
          if (file.size > 4 * 1024 * 1024 || !imageTypes.includes(file.type))
            throw new Error("Choose a PNG, JPEG or WebP image up to 4 MB.");
          const form = new FormData();
          form.append("purpose", "search");
          form.append("image", file);
          const data = await parseResponse(
            await fetch("/app/api/upload", { method: "POST", body: form }),
          );
          setResults(data);
          setSearch({ kind: "image", imageId: data.imageId });
          setSort("");
        }
      } else {
        const keyword = reuse ? search?.keyword : text;
        if (!keyword)
          throw new Error("Enter a keyword, paste a 1688 link or add a photo.");
        const data = await api("search", {
          keyword,
          page,
          sort: nextSort,
        });
        setResults(data);
        setSearch({ kind: "keyword", keyword });
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }
  async function openProduct(id: string) {
    if (detailBusy) return;
    setDetailBusy(id);
    setError("");
    try {
      setDetail(await api("detail", { id }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setDetailBusy("");
    }
  }
  async function edit() {
    if (!detail || creating) return;
    setCreating(true);
    setError("");
    try {
      const draft = await api("createDraft", {
        sourceId: detail.product.source_product_id,
      });
      navigate(`/app/editor/${draft.id}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setCreating(false);
    }
  }
  return (
    <>
      <PageHeader
        title="Find products"
        subtitle="Search 1688 by keyword, link or photo, then edit and import to Shopify."
      />
      {!settings.keyConfigured ? (
        <Banner tone="warning">
          <strong>Connect your HIOBuy API key</strong>
          <p>
            Add your key in <Link to="/app/settings">Settings</Link> to search
            real 1688 product data.
          </p>
        </Banner>
      ) : settings.environment === "sandbox" ? (
        <Banner tone="warning">
          <strong>Sandbox data</strong>
          <p>
            Results from your test API key are simulated catalogue data. They
            can only be imported as Shopify Drafts.
          </p>
        </Banner>
      ) : null}
      <section className="card search-card">
        <form
          role="search"
          aria-label="Find products"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <div
            className={`omni-search${dragging ? " dragging" : ""}`}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes("Files")) return;
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pick(e.dataTransfer.files);
            }}
          >
            <svg
              className="omni-icon"
              viewBox="0 0 24 24"
              width="20"
              height="20"
              aria-hidden="true"
            >
              {mode === "url" ? (
                <path
                  d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
              ) : (
                <>
                  <circle
                    cx="10.5"
                    cy="10.5"
                    r="6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                  <path
                    d="m15 15 4.5 4.5"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                </>
              )}
            </svg>
            {file ? (
              <span className="omni-image">
                <img src={preview} alt="" />
                <span>
                  <strong>{file.name}</strong>
                  <small>Find visually similar products</small>
                </span>
                <button
                  type="button"
                  className="omni-clear"
                  aria-label="Remove photo"
                  onClick={() => attach(null)}
                >
                  ×
                </button>
              </span>
            ) : (
              <input
                aria-label="Search keywords or paste a 1688 link"
                placeholder="Search a product, paste a 1688 link, or drop a photo"
                value={query}
                maxLength={500}
                onChange={(e) => setQuery(e.target.value)}
                onPaste={(e) => {
                  if (pick(e.clipboardData.files)) e.preventDefault();
                }}
              />
            )}
            <button
              type="button"
              className="omni-camera"
              aria-label="Search by photo"
              title="Search by photo · PNG, JPEG or WebP up to 4 MB"
              onClick={() => fileInput.current?.click()}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path
                  d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.7l1.3-2h5l1.3 2h1.7A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                <circle
                  cx="12"
                  cy="12.5"
                  r="3.4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
              </svg>
            </button>
            <input
              ref={fileInput}
              hidden
              aria-label="Image search photo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => pick(e.target.files)}
            />
            <button
              className="primary"
              disabled={busy || !settings.keyConfigured}
              type="submit"
            >
              {busy
                ? "Searching…"
                : mode === "url"
                  ? "Open product"
                  : mode === "image"
                    ? "Find similar"
                    : "Search"}
            </button>
          </div>
          <div className="search-tips">
            {mode === "url" ? (
              <span className="omni-mode">
                1688 link detected · opens this product directly
              </span>
            ) : mode === "image" ? (
              <span className="omni-mode">
                Your photo is sent through the public HIOBuy image upload and
                search APIs.
              </span>
            ) : (
              <>
                <span>Try:</span>
                {["plant watering", "spray bottle", "garden tools"].map((t) => (
                  <button
                    type="button"
                    className="chip"
                    key={t}
                    onClick={() => setQuery(t)}
                  >
                    {t}
                  </button>
                ))}
              </>
            )}
          </div>
        </form>
      </section>
      {error && <Banner tone="error">{error}</Banner>}
      {results && (
        <div className="section-heading">
          <div className="row">
            <h2>
              {search?.keyword
                ? `Results for “${search.keyword}”`
                : "Similar products"}
            </h2>
            <span className="muted">
              {results.total.toLocaleString()} results
            </span>
          </div>
          <select
            aria-label="Sort products"
            value={sort}
            disabled={busy}
            onChange={(e) => {
              setSort(e.target.value);
              void run(1, e.target.value, true);
            }}
          >
            <option value="">Recommended</option>
            <option value="PRICE_ASC">Price: low to high</option>
            <option value="PRICE_DESC">Price: high to low</option>
            <option value="SALE_QTY_DESC">Most orders</option>
          </select>
        </div>
      )}
      {busy ? (
        <div
          className="product-grid"
          aria-busy="true"
          aria-label="Searching products"
        >
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="card skeleton-card">
              <div />
              <p />
              <p />
            </div>
          ))}
        </div>
      ) : results?.items.length ? (
        <div className="product-grid">
          {results.items.map((p) => (
            <article key={p.id} className="card product-card">
              <button
                className="product-art"
                aria-label={`View ${p.title}`}
                disabled={!!detailBusy}
                onClick={() => void openProduct(p.id)}
              >
                <ProductImage src={p.image} alt={p.title} />
                <span className="source-pill">1688</span>
              </button>
              <div className="product-body">
                <h3>{p.title}</h3>
                <p className="supplier">
                  {p.supplier || "Supplier details on request"}
                </p>
                <div className="row between">
                  <strong className="product-price">
                    {p.priceCny === null
                      ? "Price on detail"
                      : `¥${p.priceCny.toFixed(2)}`}
                    <small>CNY</small>
                  </strong>
                  <button
                    className="compact"
                    disabled={!!detailBusy}
                    onClick={() => void openProduct(p.id)}
                  >
                    {detailBusy === p.id ? "Loading…" : "View details"}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="card">
          <Empty
            title={results ? "No products found" : "A new product starts here"}
          >
            {results
              ? "Try a different keyword or a clearer product photo."
              : "Search by keyword, upload a photo or paste a 1688 product URL."}
          </Empty>
        </section>
      )}
      {results && (
        <div className="pagination">
          <button
            disabled={busy || results.page <= 1}
            onClick={() => void run(results.page - 1, sort, true)}
          >
            ← Previous
          </button>
          <span>Page {results.page} · Supplier prices in CNY</span>
          <button
            disabled={
              busy ||
              results.items.length === 0 ||
              results.page * results.pageSize >= results.total ||
              results.page >= 400
            }
            onClick={() => void run(results.page + 1, sort, true)}
          >
            Next →
          </button>
        </div>
      )}
      {detail && (
        <Modal
          title="Product details"
          onClose={() => {
            if (!creating) setDetail(null);
          }}
          footer={
            <>
              <a
                className="button"
                href={detail.product.source_url || undefined}
                target="_blank"
                rel="noreferrer"
              >
                View on 1688 ↗
              </a>
              <button
                className="primary"
                disabled={creating}
                onClick={() => void edit()}
              >
                {creating ? "Preparing editor…" : "Edit & import →"}
              </button>
            </>
          }
        >
          <div className="detail-grid">
            <div>
              <ProductImage
                className="detail-hero"
                src={detail.product.images[0]?.url || ""}
                alt={detail.product.title.original}
              />
              <div className="thumbs">
                {detail.product.images.slice(1, 5).map((i) => (
                  <ProductImage
                    key={i.url}
                    src={i.url}
                    alt="Supplier product view"
                  />
                ))}
              </div>
            </div>
            <div>
              <Badge
                tone={detail.environment === "sandbox" ? "amber" : "green"}
              >
                {detail.environment === "sandbox"
                  ? "Sandbox · simulated"
                  : "1688 · source product"}
              </Badge>
              <h2 className="detail-title">
                {detail.product.title.translated ||
                  detail.product.title.original}
              </h2>
              <p className="muted">{detail.product.title.original}</p>
              <p className="large-price">
                {sourcePrice(detail.product.price) === null
                  ? "Price unavailable"
                  : `¥${sourcePrice(detail.product.price)?.toFixed(2)}`}{" "}
                <small>CNY</small>
              </p>
              <dl className="facts">
                <dt>Supplier</dt>
                <dd>{detail.product.seller?.name || "Not supplied"}</dd>
                <dt>Product ID</dt>
                <dd>{detail.product.source_product_id}</dd>
                <dt>Variants</dt>
                <dd>{detail.product.variants.length || "Single product"}</dd>
                <dt>Minimum order</dt>
                <dd>{detail.product.min_order_quantity ?? "Not supplied"}</dd>
              </dl>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Options</th>
                  <th>Source SKU</th>
                  <th>Cost · CNY</th>
                  <th>Supplier stock</th>
                </tr>
              </thead>
              <tbody>
                {detail.product.variants.slice(0, 20).map((v) => (
                  <tr key={v.sku_id}>
                    <td>
                      {v.attributes
                        .map((a) => `${a.name}: ${a.value}`)
                        .join(" / ") || "Default"}
                    </td>
                    <td>{v.sku_id}</td>
                    <td>{sourcePrice(v.price) ?? "—"}</td>
                    <td>{v.stock ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {detail.product.variants.length > 20 && (
              <p className="hint">
                Showing the first 20 variants. Review all in the editor.
              </p>
            )}
          </div>
          {error && <Banner tone="error">{error}</Banner>}
        </Modal>
      )}
    </>
  );
}
