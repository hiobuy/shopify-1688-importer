import { useEffect, useRef, useState } from "react";
import {
  Link,
  useBlocker,
  useLoaderData,
  useNavigate,
  useRevalidator,
  type LoaderFunctionArgs,
} from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getDraft } from "../lib/drafts.server";
import { listCollections, shopContext } from "../lib/shopify-graphql.server";
import { editorSchema, type Editor, type AiCapability } from "../lib/schema";
import type { SourceProduct } from "../lib/products";
import {
  ClientError,
  api,
  errorText,
  parseResponse,
  publishWhenReady,
} from "../lib/client";
import { Banner, Badge, Modal, ProductImage } from "../components/ui";
import { PageHeader } from "../components/chrome";
import { useJobs, type ClientJob } from "../components/jobs";
import {
  ProductPanel,
  DescriptionPanel,
  VariantsPanel,
  ImagesPanel,
} from "../components/editor-panels";
import { alignCurrency, calculatePrice } from "../lib/pricing";
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const draft = await getDraft(session.shop, params.id || "");
  const [collections, context, record] = await Promise.all([
    listCollections(admin),
    shopContext(admin),
    db.importRecord.findUnique({ where: { draftId: draft.id } }),
  ]);
  return {
    id: draft.id,
    source: JSON.parse(draft.sourceJson) as SourceProduct,
    editor: editorSchema.parse(JSON.parse(draft.editorJson)),
    version: draft.version,
    environment: draft.environment,
    context,
    collections,
    record: record
      ? {
          id: record.id,
          status: record.status,
          productId: record.productId,
          error: record.error,
        }
      : null,
  };
}
export default function EditorPage() {
  const data = useLoaderData<typeof loader>();
  return <EditorWorkspace key={data.id} data={data} />;
}
function EditorWorkspace({
  data,
}: {
  data: ReturnType<typeof useLoaderData<typeof loader>>;
}) {
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const { jobs, refresh } = useJobs();
  const [editor, setEditor] = useState<Editor>(data.editor);
  const latest = useRef(editor);
  const revision = useRef(0);
  const saved = useRef(0);
  const version = useRef(data.version);
  const saving = useRef<Promise<boolean> | null>(null);
  const [tab, setTab] = useState("product");
  const [saveState, setSaveState] = useState("Saved");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<ClientJob | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const imageQueue = useRef(new Map<string, AiCapability[]>());
  const starting = useRef(new Set<string>());
  const aiLock = useRef(false);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [credits, setCredits] = useState<number | null>(null);
  const [publishConfirm, setPublishConfirm] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [collections, setCollections] = useState(data.collections.nodes);
  const [pageInfo, setPageInfo] = useState(data.collections.pageInfo);
  const conflict = useRef(false);
  const locked = !!data.record;
  const blocker = useBlocker(() => revision.current > saved.current && !busy);
  const resumed = useRef(false);
  useEffect(() => {
    if (data.record?.status !== "NEEDS_RETRY" || resumed.current) return;
    resumed.current = true;
    void publish();
  });
  function switchToStoreCurrency() {
    const pricing = alignCurrency(editor.pricing, data.context.currency);
    update({
      ...editor,
      pricing,
      variants: editor.variants.map((v) => ({
        ...v,
        price: calculatePrice(v.costCny, pricing),
      })),
    });
  }
  function update(next: Editor) {
    if (locked) return;
    latest.current = next;
    revision.current++;
    setEditor(next);
    setSaveState("Unsaved changes");
  }
  async function flush(): Promise<boolean> {
    if (locked || saved.current === revision.current) return true;
    if (conflict.current) return false;
    if (saving.current) {
      if (!(await saving.current)) return false;
      return flush();
    }
    const requestRevision = revision.current;
    const snapshot = latest.current;
    const task = (async () => {
      setSaveState("Saving…");
      try {
        const result = await api("saveDraft", {
          draftId: data.id,
          version: version.current,
          editor: snapshot,
        });
        version.current = result.version;
        saved.current = requestRevision;
        setSaveState(
          saved.current === revision.current ? "Saved" : "Unsaved changes",
        );
        setError("");
        return true;
      } catch (e) {
        if ((e as { code?: string }).code === "DRAFT_CONFLICT")
          conflict.current = true;
        setSaveState("Save failed");
        setError(errorText(e));
        return false;
      }
    })();
    saving.current = task;
    const success = await task;
    saving.current = null;
    if (success && saved.current < revision.current) return flush();
    return success;
  }
  useEffect(() => {
    if (locked || revision.current === saved.current || conflict.current)
      return;
    const timer = setTimeout(() => void flush(), 900);
    return () => clearTimeout(timer);
  }, [editor, locked]);
  useEffect(() => {
    function guard(e: BeforeUnloadEvent) {
      if (revision.current > saved.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);
  async function startAi(capability: AiCapability, imageId?: string) {
    if (aiLock.current || locked) return false;
    aiLock.current = true;
    setAiBusy(true);
    try {
      if (!(await flush())) return false;
      await api("createJob", {
        draftId: data.id,
        capability,
        imageId,
      });
      await refresh();
      return true;
    } catch (e) {
      if (
        imageId &&
        e instanceof ClientError &&
        (e.code === "RATE_LIMITED" || e.status === 429)
      ) {
        setError(
          "HIOBuy is limiting how fast new image tasks can start. This one stays queued and will be sent again on its own. It was not charged again.",
        );
        await refresh();
        return "wait";
      }
      if (imageId) {
        imageQueue.current.clear();
        syncPending();
      }
      setError(errorText(e));
      return false;
    } finally {
      aiLock.current = false;
      setAiBusy(false);
    }
  }
  async function runAi(capability: AiCapability, imageId?: string) {
    await startAi(capability, imageId);
  }
  function syncPending() {
    setPendingImages([
      ...new Set([
        ...starting.current,
        ...[...imageQueue.current]
          .filter(([, waiting]) => waiting.length)
          .map(([imageId]) => imageId),
      ]),
    ]);
  }
  function imageBusy(imageId: string) {
    return jobsRef.current.some(
      (job) =>
        job.draftId === data.id &&
        job.imageId === imageId &&
        (job.status === "QUEUED" ||
          job.status === "RUNNING" ||
          (job.status === "SUCCEEDED" && !job.applied && !job.simulated)),
    );
  }
  function waitingOnHioBuy() {
    return jobsRef.current.some(
      (job) => job.status === "QUEUED" && job.errorCode === "RATE_LIMITED",
    );
  }
  function pumpImages() {
    if (locked || aiLock.current || waitingOnHioBuy()) return;
    for (const [imageId, waiting] of imageQueue.current) {
      if (!waiting.length) {
        imageQueue.current.delete(imageId);
        continue;
      }
      if (starting.current.has(imageId) || imageBusy(imageId)) continue;
      const [nextTool, ...rest] = waiting;
      imageQueue.current.set(imageId, rest);
      starting.current.add(imageId);
      syncPending();
      void startAi(nextTool, imageId).then((started) => {
        starting.current.delete(imageId);
        syncPending();
        if (started === true) pumpImages();
      });
      return;
    }
    syncPending();
  }
  function runImageTools(imageIds: string[], tools: AiCapability[]) {
    if (!tools.length || locked) return;
    for (const imageId of imageIds) {
      if (starting.current.has(imageId) || imageBusy(imageId)) continue;
      imageQueue.current.set(imageId, [
        ...(imageQueue.current.get(imageId) || []),
        ...tools,
      ]);
    }
    pumpImages();
  }
  async function upload(file: File) {
    if (uploading) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("image", file);
      form.append("draftId", data.id);
      const result = await parseResponse(
        await fetch("/app/api/upload", { method: "POST", body: form }),
      );
      update({
        ...latest.current,
        images: [...latest.current.images, result.image],
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setUploading(false);
    }
  }
  async function publish() {
    if (busy) return;
    setBusy(true);
    setPublishConfirm(false);
    setError("");
    try {
      if (!locked && !(await flush())) return;
      await publishWhenReady(
        data.id,
        locked ? undefined : version.current,
        () => setWaiting(true),
      );
      navigate("/app/history");
    } catch (e) {
      setError(errorText(e));
      revalidator.revalidate();
    } finally {
      setBusy(false);
      setWaiting(false);
    }
  }
  async function apply() {
    if (!preview?.result || aiBusy) return;
    setAiBusy(true);
    try {
      const next = structuredClone(latest.current);
      const r = preview.result;
      if (preview.capability === "title_translation") {
        const text = (r.text || "").trim();
        if (!text || text.length > 255) {
          setError(
            "The translation must be 1–255 characters. Edit the title manually instead of applying this result.",
          );
          return;
        }
        next.title = text;
      } else if (preview.capability === "description_translation")
        next.descriptionHtml = r.text || next.descriptionHtml;
      else if (preview.capability === "seo_description")
        next.seoDescription = (r.text || "").slice(0, 320);
      else if (preview.capability === "attribute_translation")
        next.attributes = r.attributes || next.attributes;
      else if (r.imageId)
        next.images = next.images.map((i) =>
          i.id === r.imageId
            ? r.simulated
              ? { ...i, mockApplied: true }
              : {
                  ...i,
                  url: r.imageUrl || i.url,
                  assetId: r.assetId || i.assetId,
                  aiSourceUrl: r.remoteUrl || i.aiSourceUrl,
                  mockApplied: false,
                }
            : i,
        );
      update(next);
      if (!(await flush())) return;
      await api("markJobApplied", { jobId: preview.id });
      await refresh();
      setPreview(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setAiBusy(false);
    }
  }
  async function applyImage(job: ClientJob, replace: boolean) {
    if (aiBusy || locked || !job.result?.imageId) return;
    setAiBusy(true);
    try {
      const result = job.result;
      if (replace && result) {
        const next = structuredClone(latest.current);
        next.images = next.images.map((image) =>
          image.id === result.imageId
            ? {
                ...image,
                url: result.imageUrl || image.url,
                assetId: result.assetId || image.assetId,
                aiSourceUrl: result.remoteUrl || image.aiSourceUrl,
                mockApplied: false,
              }
            : image,
        );
        update(next);
        if (!(await flush())) return;
      }
      await api("markJobApplied", { jobId: job.id });
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setAiBusy(false);
    }
  }
  useEffect(() => {
    pumpImages();
  }, [jobs, locked, data.id]);
  const settledJobs = jobs.filter(
    (job) =>
      job.draftId === data.id &&
      (job.status === "SUCCEEDED" || job.status === "FAILED"),
  ).length;
  useEffect(() => {
    if (locked) return;
    let live = true;
    api<{ creditsBalance: number }>("aiCredits")
      .then((result) => {
        if (live) setCredits(result.creditsBalance);
      })
      .catch(() => {
        if (live) setCredits(null);
      });
    return () => {
      live = false;
    };
  }, [settledJobs, locked]);
  async function duplicate() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await api("duplicateDraft", { draftId: data.id });
      navigate(`/app/editor/${result.id}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const selected = editor.variants.filter((v) => v.selected);
  const selectedImages = editor.images.filter((i) => i.selected);
  const panels = {
    product: ProductPanel,
    description: DescriptionPanel,
    variants: VariantsPanel,
    images: ImagesPanel,
  };
  const Panel = panels[tab as keyof typeof panels];
  const draftJobs = jobs.filter((j) => j.draftId === data.id);
  return (
    <>
      <PageHeader
        title="Edit product"
        backTo="/app"
        subtitle="Review the details before adding this product to your store."
        actions={locked && <Badge>Import snapshot</Badge>}
      />
      <div className="sourcebar">
        <Badge>1688</Badge>
        <span>
          {data.source.source_url ||
            `Source product ${data.source.source_product_id}`}
        </span>
        {data.source.source_url && (
          <a href={data.source.source_url} target="_blank" rel="noreferrer">
            View source ↗
          </a>
        )}
      </div>
      {data.environment === "sandbox" && (
        <Banner tone="warning">
          <strong>Sandbox source · simulated product data.</strong>
          <p>
            This product can only be imported as a Shopify Draft. It is not a
            verified sellable offer.
          </p>
        </Banner>
      )}
      {data.context.missingScopes.length > 0 && (
        <Banner tone="warning">
          Missing Shopify permissions: {data.context.missingScopes.join(", ")}.
          Update your app configuration and reauthorize.
        </Banner>
      )}
      {!locked && editor.pricing.currency !== data.context.currency && (
        <Banner tone="warning">
          <div className="currency-alert">
            <span>
              <strong>
                This draft uses {editor.pricing.currency}, but your store sells
                in {data.context.currency}.
              </strong>
              <p>Shopify only accepts prices in the store currency.</p>
            </span>
            <button disabled={busy} onClick={switchToStoreCurrency}>
              Switch to {data.context.currency} and recalculate
            </button>
          </div>
        </Banner>
      )}
      {waiting && (
        <Banner>
          <strong>Shopify is processing the product images…</strong>
          <p>
            This usually takes under a minute. The import finishes on its own.
          </p>
        </Banner>
      )}
      {error && <Banner tone="error">{error}</Banner>}
      {data.record && data.record.status !== "SUCCEEDED" && !waiting && (
        <Banner tone="warning">
          <strong>
            {data.record.status === "FAILED"
              ? "This import did not finish."
              : "This import is still in progress."}
          </strong>
          <p>
            {data.record.error ||
              "Finishing it reuses this exact version and the same Shopify product."}{" "}
            To change the product, reopen it as a new draft instead. That
            creates a separate product.
          </p>
          <div className="row wrap">
            <button
              className="primary"
              disabled={busy}
              onClick={() => void publish()}
            >
              {busy ? "Finishing import…" : "Finish import"}
            </button>
            <button disabled={busy} onClick={() => void duplicate()}>
              Reopen as new draft
            </button>
          </div>
        </Banner>
      )}
      {data.record?.status === "SUCCEEDED" && (
        <Banner tone="success">
          <strong>Imported to Shopify.</strong>
          <p>
            This version is locked. Reopen it as a new draft to make another
            product from it.
          </p>
          <div className="row wrap">
            <Link className="button" to="/app/history">
              View import history
            </Link>
            <button disabled={busy} onClick={() => void duplicate()}>
              Reopen as new draft
            </button>
          </div>
        </Banner>
      )}
      <div className="editor-layout">
        <section className="card editor-main">
          <div
            className="editor-tabs"
            role="tablist"
            aria-label="Product editing"
          >
            {[
              ["product", "Product"],
              ["description", "Description"],
              ["variants", "Variants & Pricing"],
              ["images", `Images (${editor.images.length})`],
            ].map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                id={`tab-${key}`}
                aria-controls="editor-panel"
                className={tab === key ? "selected" : ""}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div
            className="editor-panel"
            id="editor-panel"
            role="tabpanel"
            aria-labelledby={`tab-${tab}`}
          >
            <Panel
              editor={editor}
              source={data.source}
              update={update}
              disabled={locked || busy}
              runAi={(c, i) => void runAi(c, i)}
              runImageTools={runImageTools}
              jobs={draftJobs}
              pendingImageIds={pendingImages}
              credits={credits}
              applyImage={(job, replace) => void applyImage(job, replace)}
              collections={collections}
              upload={upload}
              uploading={uploading}
            />
            {tab === "product" && pageInfo.hasNextPage && (
              <button
                disabled={busy}
                onClick={async () => {
                  try {
                    const result = await api("collections", {
                      after: pageInfo.endCursor,
                    });
                    setCollections((c) => [...c, ...result.nodes]);
                    setPageInfo(result.pageInfo);
                  } catch (e) {
                    setError(errorText(e));
                  }
                }}
              >
                Load more collections
              </button>
            )}
          </div>
        </section>
        <aside className="editor-aside">
          <section className="card summary-card">
            <p className="eyebrow">IMPORT SUMMARY</p>
            <h2>Ready for your store</h2>
            <dl className="facts">
              <dt>Destination</dt>
              <dd>{data.context.domain}</dd>
              <dt>Currency</dt>
              <dd>{editor.pricing.currency}</dd>
              <dt>Selected variants</dt>
              <dd>{selected.length}</dd>
              <dt>Selected images</dt>
              <dd>{selectedImages.length}</dd>
              <dt>Source</dt>
              <dd>
                {data.environment === "sandbox"
                  ? "Sandbox simulation"
                  : "1688 via HIOBuy"}
              </dd>
            </dl>
            <label>
              Shopify product status
              <select
                disabled={locked || busy}
                value={editor.pricing.publishStatus}
                onChange={(e) =>
                  update({
                    ...editor,
                    pricing: {
                      ...editor.pricing,
                      publishStatus: e.target.value as "DRAFT" | "ACTIVE",
                    },
                  })
                }
              >
                <option value="DRAFT">Draft</option>
                <option
                  value="ACTIVE"
                  disabled={data.environment === "sandbox"}
                >
                  Active
                </option>
              </select>
            </label>
            <p className="hint">
              Active sets the product status. Manage storefront sales channels
              in Shopify Admin.
            </p>
          </section>
          <section className="card ai-summary">
            <Badge tone="violet">✧ COMMERCE AI</Badge>
            <h3>Translation and image tools</h3>
            <p className="muted">
              In Images, hover a picture and pick a tool, or check several and
              use Bulk actions. Open a finished image to compare it, then
              confirm the replacement.
            </p>
            <p className="hint">
              Credits are separate from product API quota. Text translations
              still wait for you to apply them.
            </p>
            {draftJobs.map((j) => (
              <div className="draft-job" key={j.id}>
                <div>
                  <strong>{j.capability.replaceAll("_", " ")}</strong>
                  <small>
                    {j.applied
                      ? "Result applied"
                      : j.billingState === "reconciliation" ||
                          j.billingState === "provider_succeeded"
                        ? "Settling"
                        : j.status.toLowerCase()}
                  </small>
                </div>
                {j.status === "SUCCEEDED" && (
                  <button
                    className="compact"
                    disabled={locked || busy || aiBusy}
                    onClick={() => setPreview(j)}
                  >
                    {j.applied ? "View" : "Preview"}
                  </button>
                )}
                {j.status === "FAILED" &&
                  j.errorCode !== "REJECTED" &&
                  j.errorCode !== "REFUNDED" && (
                    <button
                      className="compact"
                      disabled={locked || aiBusy}
                      onClick={async () => {
                        try {
                          await api("retryJob", { jobId: j.id });
                          await refresh();
                        } catch (e) {
                          setError(errorText(e));
                        }
                      }}
                    >
                      Retry
                    </button>
                  )}
              </div>
            ))}
          </section>
        </aside>
      </div>
      <div className="import-footer">
        <span className="save-indicator" role="status">
          {busy
            ? "Uploading media and writing product to Shopify…"
            : aiBusy
              ? "Starting AI task…"
              : saveState === "Saved"
                ? "✓ All changes saved"
                : saveState}
        </span>
        <div className="row">
          <button disabled={locked || busy} onClick={() => void flush()}>
            Save draft
          </button>
          <button
            className="primary"
            disabled={
              locked ||
              busy ||
              aiBusy ||
              uploading ||
              !selected.length ||
              !!data.context.missingScopes.length
            }
            onClick={() => setPublishConfirm(true)}
          >
            {busy ? "Importing…" : `Import to Shopify →`}
          </button>
        </div>
      </div>
      {preview && (
        <Modal
          title={
            preview.simulated ? "Simulated AI result" : "Commerce AI result"
          }
          onClose={() => {
            if (!aiBusy) setPreview(null);
          }}
          footer={
            <>
              <button disabled={aiBusy} onClick={() => setPreview(null)}>
                Keep original
              </button>
              <button
                className="primary"
                disabled={
                  aiBusy ||
                  preview.applied ||
                  locked ||
                  (!preview.simulated &&
                    !!preview.result?.imageId &&
                    !preview.result.assetId)
                }
                onClick={() => void apply()}
              >
                {aiBusy
                  ? "Saving…"
                  : preview.simulated
                    ? "Use simulated result"
                    : "Use this result"}
              </button>
            </>
          }
        >
          <Banner tone="warning">{preview.result?.notice}</Banner>
          {preview.result?.imageUrl && preview.simulated ? (
            <div className="mock-image-preview">
              <ProductImage
                src={preview.result.imageUrl}
                alt="Mock preview: original image without processing"
              />
              <span className="mock-watermark">SIMULATED · ORIGINAL IMAGE</span>
              <p>
                Confirming marks this image as a mock result. The original
                pixels and source URL are preserved.
              </p>
            </div>
          ) : preview.result?.imageUrl ? (
            <div className="mock-image-preview">
              <ProductImage
                src={preview.result.imageUrl}
                alt="Commerce AI image result"
              />
              <p>
                This copy is stored with the draft. Applying it replaces the
                editor image and keeps the supplier original available.
              </p>
            </div>
          ) : (
            <pre className="mock-text">
              {preview.result?.text ||
                JSON.stringify(preview.result?.attributes, null, 2)}
            </pre>
          )}
        </Modal>
      )}
      {publishConfirm && (
        <Modal
          title="Import this product to Shopify?"
          onClose={() => setPublishConfirm(false)}
          footer={
            <>
              <button onClick={() => setPublishConfirm(false)}>
                Keep editing
              </button>
              <button className="primary" onClick={() => void publish()}>
                Create{" "}
                {editor.pricing.publishStatus === "DRAFT" ? "draft" : "active"}{" "}
                product
              </button>
            </>
          }
        >
          <p>
            This creates a real product in{" "}
            <strong>{data.context.domain}</strong> with {selected.length}{" "}
            variants and {selectedImages.length} images.
          </p>
          <p>
            Prices are in {data.context.currency}. Status:{" "}
            <strong>{editor.pricing.publishStatus}</strong>.
          </p>
          {data.environment === "sandbox" && (
            <Banner tone="warning">
              This is simulated Sandbox source data. The Shopify Draft is real.
            </Banner>
          )}
        </Modal>
      )}
      {blocker.state === "blocked" && (
        <Modal
          title="Save your edits before leaving?"
          onClose={() => blocker.reset()}
          footer={
            <>
              <button onClick={() => blocker.reset()}>Keep editing</button>
              <button onClick={() => blocker.proceed()}>
                Discard unsaved edits
              </button>
              <button
                className="primary"
                onClick={async () => {
                  if (await flush()) blocker.proceed();
                }}
              >
                Save & leave
              </button>
            </>
          }
        >
          <p>Your latest changes have not reached the database yet.</p>
        </Modal>
      )}
    </>
  );
}
