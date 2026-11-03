// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ProductPanel,
  DescriptionPanel,
  VariantsPanel,
  ImagesPanel,
} from "../app/components/editor-panels";
import { source, editorFixture } from "./fixtures";
import type { Editor } from "../app/lib/schema";
import type { ClientJob } from "../app/components/jobs";
afterEach(cleanup);
function Harness() {
  const [tab, setTab] = useState("product");
  const [editor, setEditor] = useState<Editor>(editorFixture());
  const Panels = {
    product: ProductPanel,
    description: DescriptionPanel,
    variants: VariantsPanel,
    images: ImagesPanel,
  };
  const Panel = Panels[tab as keyof typeof Panels];
  return (
    <>
      <nav>
        {Object.keys(Panels).map((key) => (
          <button key={key} onClick={() => setTab(key)}>
            {key}
          </button>
        ))}
      </nav>
      <Panel
        editor={editor}
        source={source}
        update={setEditor}
        disabled={false}
        runAi={vi.fn()}
        collections={[
          { id: "gid://shopify/Collection/123", title: "Test collection" },
        ]}
        upload={async () => {}}
        uploading={false}
      />
      <output data-testid="editor-state">{JSON.stringify(editor)}</output>
    </>
  );
}
function state() {
  return JSON.parse(
    screen.getByTestId("editor-state").textContent || "{}",
  ) as Editor;
}
describe("four-tab product workbench", () => {
  it("keeps title, description, pricing, selection and images when switching tabs", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const title = screen.getByLabelText(/^Shopify title/);
    await user.clear(title);
    await user.type(title, "A new title");
    await user.click(screen.getByText("description", { selector: "button" }));
    const description = screen.getByLabelText("Shopify description");
    description.innerHTML = "<p>Edited description</p>";
    fireEvent.input(description);
    await user.click(screen.getByText("variants", { selector: "button" }));
    const price = screen.getByLabelText("Shopify price test-sku-green-s");
    fireEvent.change(price, { target: { value: "19.99" } });
    await user.click(screen.getByLabelText("Select SKU test-sku-green-l"));
    await user.click(screen.getByText("images", { selector: "button" }));
    await user.click(screen.getByLabelText("Move image 2 earlier"));
    await user.click(screen.getByText("product", { selector: "button" }));
    expect(
      (screen.getByLabelText(/^Shopify title/) as HTMLInputElement).value,
    ).toBe("A new title");
    expect(state()).toMatchObject({
      descriptionHtml: "<p>Edited description</p>",
      variants: [{ price: "19.99" }, { selected: false }],
      images: [{ id: "image-2" }, { id: "image-1" }],
    });
  });
  it("allows typing multiple comma-separated tags", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText(/^Tags/), "garden, watering");
    expect(state().tags).toEqual(["garden", "watering"]);
  });
  it("clears variant associations when excluding an image and keeps original URLs", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("images", { selector: "button" }));
    await user.click(screen.getByLabelText("Select image 1"));
    expect(state().variants[0].imageId).toBe(null);
    expect(state().images[0].originalUrl).toBe(source.images[0].url);
  });
  it("updates an option name consistently across all variants", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("variants", { selector: "button" }));
    fireEvent.change(
      screen.getByLabelText("Option 1 name"),
      { target: { value: "Shade" } },
    );
    expect(state().variants.map((v) => v.options[0].name)).toEqual([
      "Shade",
      "Shade",
    ]);
  });
  it("edits the description as formatted text and drops scripts", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("description", { selector: "button" }));
    const description = screen.getByLabelText("Shopify description");
    expect(description.getAttribute("role")).toBe("textbox");
    expect(screen.queryByLabelText("Shopify description · HTML")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Full screen" }));
    expect(description.closest(".rich-text")?.className).toContain("is-full");
    await user.keyboard("{Escape}");
    expect(description.closest(".rich-text")?.className).not.toContain(
      "is-full",
    );
    description.innerHTML = "<script>window.bad=true</script><p>Preview</p>";
    fireEvent.input(description);
    expect(state().descriptionHtml).toContain("Preview");
    expect(state().descriptionHtml).not.toMatch(/script|window\.bad/i);
    expect(description.querySelector("script")).toBe(null);
    description.innerHTML = '<p><img src="https://img.alicdn.com/a.jpg"></p>';
    fireEvent.input(description);
    expect(
      description.querySelector("img")?.getAttribute("referrerpolicy"),
    ).toBe("no-referrer");
  });
  it("runs one image tool per click and bulk tools on checked images", async () => {
    const user = userEvent.setup();
    const runImageTools = vi.fn();
    function ImagesHarness() {
      const [editor, setEditor] = useState<Editor>(editorFixture());
      return (
        <ImagesPanel
          editor={editor}
          source={source}
          update={setEditor}
          disabled={false}
          runAi={vi.fn()}
          runImageTools={runImageTools}
          collections={[]}
          upload={async () => {}}
          uploading={false}
        />
      );
    }
    render(<ImagesHarness />);
    expect(screen.queryByRole("button", { name: /Run selected tools/ })).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Erase Chinese text on image 1" }),
    );
    expect(runImageTools).toHaveBeenLastCalledWith(["image-1"], ["image_text"]);
    await user.click(screen.getByLabelText("Select image 2"));
    await user.click(screen.getByRole("button", { name: /Bulk actions/ }));
    await user.click(
      screen.getByRole("menuitem", { name: /White background/ }),
    );
    expect(runImageTools).toHaveBeenLastCalledWith(
      ["image-1"],
      ["image_background"],
    );
  });
  it("shows a busy image without its tools", () => {
    render(
      <ImagesPanel
        editor={editorFixture()}
        source={source}
        update={vi.fn()}
        disabled={false}
        runAi={vi.fn()}
        pendingImageIds={["image-1"]}
        collections={[]}
        upload={async () => {}}
        uploading={false}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Erase Chinese text on image 1" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Erase Chinese text on image 2" }),
    ).toBeTruthy();
  });
  it("compares a finished image in a large view and confirms replacement", async () => {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function close() {
      this.open = false;
    };
    const user = userEvent.setup();
    const applyImage = vi.fn();
    const job: ClientJob = {
      id: "job-1",
      draftId: "draft-1",
      capability: "image_text",
      status: "SUCCEEDED",
      provider: "hiobuy",
      simulated: false,
      attempts: 1,
      applied: false,
      error: null,
      errorCode: null,
      imageId: "image-1",
      billingState: null,
      result: {
        simulated: false,
        notice: "ready",
        imageId: "image-1",
        imageUrl: "https://img.alicdn.com/ai-result.jpg",
        assetId: "asset-1",
      },
    };
    render(
      <ImagesPanel
        editor={editorFixture()}
        source={source}
        update={vi.fn()}
        disabled={false}
        runAi={vi.fn()}
        jobs={[job]}
        applyImage={applyImage}
        collections={[]}
        upload={async () => {}}
        uploading={false}
      />,
    );
    expect(document.querySelector(".img-compare")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Erase Chinese text on image 1" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Erase Chinese text on image 2" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Review" }));
    expect(document.querySelector(".img-compare")).toBeTruthy();
    expect(document.querySelector(".img-compare-knob")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Replace image" }));
    expect(applyImage).toHaveBeenCalledWith(job, true);
  });
  it("asks before removing an image", async () => {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function close() {
      this.open = false;
    };
    const user = userEvent.setup();
    function ImagesHarness() {
      const [editor, setEditor] = useState<Editor>(editorFixture());
      return (
        <>
          <ImagesPanel
            editor={editor}
            source={source}
            update={setEditor}
            disabled={false}
            runAi={vi.fn()}
            collections={[]}
            upload={async () => {}}
            uploading={false}
          />
          <output data-testid="images">{editor.images.length}</output>
        </>
      );
    }
    render(<ImagesHarness />);
    await user.click(
      screen.getByRole("button", { name: (name) => name === "Remove image 1" }),
    );
    expect(screen.getByTestId("images").textContent).toBe("2");
    await user.click(
      screen.getByRole("button", { name: (name) => name === "Remove image" }),
    );
    expect(screen.getByTestId("images").textContent).toBe("1");
  });
});
