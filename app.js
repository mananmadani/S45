/* ============================================================
   S45 Jeans Co — Order Form App
   Pure frontend: IndexedDB storage + client-side PDF generation
   ============================================================ */

(() => {
  "use strict";

  /* ---------------- Company / Firm constants ---------------- */
  const COMPANY = {
    name: "S45 Jeans Co",
    firm: "Ratan Fashion",
    gstin: "24ABZPK8899B1ZV",
    mobile: "+91 96624 89952",
    address: "G-257, City Centre, Near Idgah Circle, Asarwa, Ahmedabad, Gujarat, India 380001",
    website: "s45jeans.pages.dev",
    logo: "s45.png"
  };

  /* ---------------- IndexedDB helper ---------------- */
  const DB_NAME = "S45JeansDB";
  const DB_VERSION = 1;
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("orders")) {
          const store = db.createObjectStore("orders", { keyPath: "id", autoIncrement: true });
          store.createIndex("orderNumber", "orderNumber", { unique: true });
          store.createIndex("createdAt", "createdAt", { unique: false });
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
    return dbPromise;
  }

  function tx(storeName, mode) {
    return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  const DB = {
    async getAllOrders() {
      const store = await tx("orders", "readonly");
      const all = await reqToPromise(store.getAll());
      return all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    },
    async getOrder(id) {
      const store = await tx("orders", "readonly");
      return reqToPromise(store.get(id));
    },
    async putOrder(order) {
      const store = await tx("orders", "readwrite");
      return reqToPromise(store.put(order));
    },
    async deleteOrder(id) {
      const store = await tx("orders", "readwrite");
      return reqToPromise(store.delete(id));
    },
    async getMeta(key) {
      const store = await tx("meta", "readonly");
      return reqToPromise(store.get(key));
    },
    async setMeta(key, value) {
      const store = await tx("meta", "readwrite");
      return reqToPromise(store.put({ key, value }));
    },
    async getAllMeta() {
      const store = await tx("meta", "readonly");
      return reqToPromise(store.getAll());
    },
    async clearOrders() {
      const store = await tx("orders", "readwrite");
      return reqToPromise(store.clear());
    },
    async clearMeta() {
      const store = await tx("meta", "readwrite");
      return reqToPromise(store.clear());
    }
  };

  /* ---------------- Order number generation ---------------- */
  // Indian financial year: Apr - Mar. e.g. Aug 2026 -> "26-27"
  function financialYearTag(date = new Date()) {
    const y = date.getFullYear();
    const m = date.getMonth() + 1; // 1-12
    const startYear = m >= 4 ? y : y - 1;
    const endYear = startYear + 1;
    return `${String(startYear).slice(-2)}-${String(endYear).slice(-2)}`;
  }

  function formatOrderNumber(seq, date = new Date()) {
    return `S45/${financialYearTag(date)}/${String(seq).padStart(4, "0")}`;
  }

  // Counter is scoped per financial year (key: "orderCounter:26-27") so the
  // sequence automatically restarts at 0001 the moment a new FY begins.
  function counterKeyFor(date = new Date()) {
    return `orderCounter:${financialYearTag(date)}`;
  }

  async function peekNextOrderNumber() {
    const meta = await DB.getMeta(counterKeyFor());
    const next = (meta ? meta.value : 0) + 1;
    return formatOrderNumber(next);
  }

  async function commitNextOrderNumber() {
    const key = counterKeyFor();
    const meta = await DB.getMeta(key);
    const next = (meta ? meta.value : 0) + 1;
    await DB.setMeta(key, next);
    return formatOrderNumber(next);
  }

  /* ---------------- State ---------------- */
  let state = {
    editingId: null,        // null = new order, otherwise editing existing order id
    orderNumber: null,      // finalized once saved; preview shown until then
    items: []                // { srNo, designNo, particulars, sizeChart, price }
  };

  let itemUid = 0;
  function newItem() {
    itemUid += 1;
    return { uid: itemUid, designNo: "", particulars: "", sizeChart: "", price: "" };
  }

  /* ---------------- DOM refs ---------------- */
  const $ = (sel) => document.querySelector(sel);
  const el = {
    orderNumber: $("#orderNumber"),
    form: $("#orderForm"),
    partyName: $("#partyName"),
    partyAddress: $("#partyAddress"),
    partyMobile: $("#partyMobile"),
    partyGSTIN: $("#partyGSTIN"),
    agentName: $("#agentName"),
    deliveryDate: $("#deliveryDate"),
    orderNotes: $("#orderNotes"),
    itemsBody: $("#itemsBody"),
    addRow: $("#addRow"),
    totalItems: $("#totalItems"),
    btnNew: $("#btnNew"),
    btnSave: $("#btnSave"),
    btnPdf: $("#btnPdf"),
    btnShare: $("#btnShare"),
    btnOrders: $("#btnOrders"),
    ordersBadge: $("#ordersBadge"),
    drawer: $("#drawer"),
    drawerOverlay: $("#drawerOverlay"),
    drawerClose: $("#drawerClose"),
    ordersList: $("#ordersList"),
    searchOrders: $("#searchOrders"),
    btnBackup: $("#btnBackup"),
    btnRestore: $("#btnRestore"),
    btnEraseAll: $("#btnEraseAll"),
    restoreFileInput: $("#restoreFileInput"),
    toast: $("#toast"),
    printRoot: $("#printRoot"),
    appRoot: $("#appRoot"),
    lockScreen: $("#lockScreen"),
    lockForm: $("#lockForm"),
    lockPassword: $("#lockPassword"),
    lockToggle: $("#lockToggle"),
    lockError: $("#lockError")
  };

  /* ---------------- Toast ---------------- */
  let toastTimer = null;
  function showToast(msg, kind = "") {
    el.toast.textContent = msg;
    el.toast.className = "toast show" + (kind ? " " + kind : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.className = "toast"; }, 2600);
  }

  /* ---------------- Items rendering ---------------- */
  function renderItems() {
    el.itemsBody.innerHTML = "";
    state.items.forEach((item, idx) => {
      const row = document.createElement("div");
      row.className = "item-row";
      row.dataset.uid = item.uid;
      row.innerHTML = `
        <span class="sr">${idx + 1}</span>
        <span class="field-wrap"><label>Design No.</label><input type="text" class="f-design" placeholder="e.g. DX-102" value="${escapeAttr(item.designNo)}" /></span>
        <span class="field-wrap"><label>Particulars</label><input type="text" class="f-particulars" placeholder="e.g. Slim Fit Denim" value="${escapeAttr(item.particulars)}" /></span>
        <span class="field-wrap"><label>Size Chart</label><input type="text" class="f-size" placeholder="e.g. 30x2,32x3,34x1" value="${escapeAttr(item.sizeChart)}" /></span>
        <span class="field-wrap"><label>Price</label><input type="number" step="0.01" min="0" class="f-price price-input" placeholder="0.00" value="${escapeAttr(item.price)}" /></span>
        <button type="button" class="rowdel" aria-label="Remove item">
          <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zm-2 6h10l-1 12H8L7 9z"/></svg>
        </button>
      `;
      el.itemsBody.appendChild(row);
    });
    updateTotals();
  }

  function escapeAttr(v) {
    return String(v ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function updateTotals() {
    el.totalItems.textContent = state.items.length;
  }

  el.itemsBody.addEventListener("input", (e) => {
    const row = e.target.closest(".item-row");
    if (!row) return;
    const uid = Number(row.dataset.uid);
    const item = state.items.find((i) => i.uid === uid);
    if (!item) return;
    if (e.target.classList.contains("f-design")) item.designNo = e.target.value;
    else if (e.target.classList.contains("f-particulars")) item.particulars = e.target.value;
    else if (e.target.classList.contains("f-size")) item.sizeChart = e.target.value;
    else if (e.target.classList.contains("f-price")) { item.price = e.target.value; updateTotals(); }
  });

  el.itemsBody.addEventListener("click", (e) => {
    const btn = e.target.closest(".rowdel");
    if (!btn) return;
    const row = btn.closest(".item-row");
    const uid = Number(row.dataset.uid);
    if (state.items.length <= 1) {
      showToast("At least one item row is required", "error");
      return;
    }
    state.items = state.items.filter((i) => i.uid !== uid);
    renderItems();
  });

  el.addRow.addEventListener("click", () => {
    state.items.push(newItem());
    renderItems();
    // focus the newly added row's first input
    const rows = el.itemsBody.querySelectorAll(".item-row");
    const last = rows[rows.length - 1];
    if (last) last.querySelector(".f-design")?.focus();
  });

  /* ---------------- Form reset / new order ---------------- */
  async function startNewOrder() {
    state.editingId = null;
    state.items = [newItem()];
    el.form.reset();
    el.orderNumber.textContent = await peekNextOrderNumber();
    renderItems();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function collectFormData() {
    return {
      partyName: el.partyName.value.trim(),
      partyAddress: el.partyAddress.value.trim(),
      partyMobile: el.partyMobile.value.trim(),
      partyGSTIN: el.partyGSTIN.value.trim().toUpperCase(),
      agentName: el.agentName.value.trim(),
      deliveryDate: el.deliveryDate.value,
      orderNotes: el.orderNotes.value.trim()
    };
  }

  function fillFormFromOrder(order) {
    el.partyName.value = order.partyName || "";
    el.partyAddress.value = order.partyAddress || "";
    el.partyMobile.value = order.partyMobile || "";
    el.partyGSTIN.value = order.partyGSTIN || "";
    el.agentName.value = order.agentName || "";
    el.deliveryDate.value = order.deliveryDate || "";
    el.orderNotes.value = order.orderNotes || "";
    state.items = (order.items && order.items.length ? order.items : [{}]).map((it) => {
      itemUid += 1;
      return { uid: itemUid, designNo: it.designNo || "", particulars: it.particulars || "", sizeChart: it.sizeChart || "", price: it.price ?? "" };
    });
    el.orderNumber.textContent = order.orderNumber;
    renderItems();
  }

  /* ---------------- Save ---------------- */
  async function saveOrder() {
    const data = collectFormData();
    if (!data.partyName) {
      showToast("Party name is required", "error");
      el.partyName.focus();
      return null;
    }
    const cleanItems = state.items
      .map((it, idx) => ({
        srNo: idx + 1,
        designNo: it.designNo?.trim() || "",
        particulars: it.particulars?.trim() || "",
        sizeChart: it.sizeChart?.trim() || "",
        price: it.price !== "" && it.price != null ? parseFloat(it.price) || 0 : 0
      }))
      .filter((it) => it.designNo || it.particulars || it.sizeChart || it.price);

    if (cleanItems.length === 0) {
      showToast("Add at least one order item", "error");
      return null;
    }

    let orderNumber = state.editingId ? el.orderNumber.textContent.trim() : null;
    if (!orderNumber) {
      orderNumber = await commitNextOrderNumber();
    }

    const order = {
      ...(state.editingId ? { id: state.editingId } : {}),
      orderNumber,
      ...data,
      items: cleanItems,
      createdAt: state.editingId ? (await DB.getOrder(state.editingId))?.createdAt || Date.now() : Date.now(),
      updatedAt: Date.now()
    };

    const id = await DB.putOrder(order);
    state.editingId = id;
    el.orderNumber.textContent = orderNumber;
    showToast(state.editingId ? "Order saved" : "Order saved", "success");
    await refreshBadge();
    return { ...order, id };
  }

  el.btnSave.addEventListener("click", async () => {
    await saveOrder();
  });

  el.btnNew.addEventListener("click", () => {
    startNewOrder();
  });

  /* ---------------- Saved Orders Drawer ---------------- */
  async function refreshBadge() {
    const all = await DB.getAllOrders();
    el.ordersBadge.textContent = all.length;
    el.ordersBadge.hidden = all.length === 0;
    return all;
  }

  function orderCard(order) {
    const div = document.createElement("div");
    div.className = "order-card";
    const dt = order.deliveryDate ? new Date(order.deliveryDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
    div.innerHTML = `
      <div class="order-card__top">
        <span class="order-card__no">${escapeAttr(order.orderNumber)}</span>
        <span class="order-card__date">${dt}</span>
      </div>
      <div class="order-card__party">${escapeAttr(order.partyName)}</div>
      <div class="order-card__meta">${order.items?.length || 0} item(s)${order.agentName ? " · " + escapeAttr(order.agentName) : ""}</div>
      <div class="order-card__actions">
        <button type="button" class="load">Open</button>
        <button type="button" class="pdf">PDF</button>
        <button type="button" class="del">Delete</button>
      </div>
    `;
    div.querySelector(".load").addEventListener("click", (e) => {
      e.stopPropagation();
      state.editingId = order.id;
      fillFormFromOrder(order);
      closeDrawer();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    div.querySelector(".pdf").addEventListener("click", async (e) => {
      e.stopPropagation();
      await generatePdfBlob(order).then((blob) => downloadBlob(blob, `${order.orderNumber.replace(/\//g, "-")}.pdf`));
    });
    div.querySelector(".del").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete order ${order.orderNumber}? This cannot be undone.`)) return;
      await DB.deleteOrder(order.id);
      if (state.editingId === order.id) startNewOrder();
      await populateDrawer();
      await refreshBadge();
      showToast("Order deleted");
    });
    return div;
  }

  async function populateDrawer(filter = "") {
    const all = await DB.getAllOrders();
    const f = filter.trim().toLowerCase();
    const filtered = f
      ? all.filter((o) =>
          (o.partyName || "").toLowerCase().includes(f) ||
          (o.agentName || "").toLowerCase().includes(f) ||
          (o.orderNumber || "").toLowerCase().includes(f))
      : all;

    el.ordersList.innerHTML = "";
    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = f ? "No orders match your search." : "No saved orders yet. Fill the form and tap Save Order.";
      el.ordersList.appendChild(empty);
      return;
    }
    filtered.forEach((o) => el.ordersList.appendChild(orderCard(o)));
  }

  function openDrawer() {
    el.drawerOverlay.hidden = false;
    el.drawer.classList.add("open");
    el.drawer.setAttribute("aria-hidden", "false");
    populateDrawer(el.searchOrders.value);
  }
  function closeDrawer() {
    el.drawer.classList.remove("open");
    el.drawer.setAttribute("aria-hidden", "true");
    setTimeout(() => { el.drawerOverlay.hidden = true; }, 250);
  }

  el.btnOrders.addEventListener("click", openDrawer);
  el.drawerClose.addEventListener("click", closeDrawer);
  el.drawerOverlay.addEventListener("click", closeDrawer);

  /* ---------------- Backup / Restore / Erase ----------------
     Everything lives in IndexedDB on this one device/browser, so switching
     phones or clearing browser data loses it all. These let the user export
     a JSON backup file, restore it (e.g. on a new device), or wipe
     everything on purpose. */

  el.btnBackup.addEventListener("click", async () => {
    el.btnBackup.disabled = true;
    try {
      const [orders, meta] = await Promise.all([DB.getAllOrders(), DB.getAllMeta()]);
      const payload = {
        app: "S45 Jeans Co Order Form",
        backupVersion: 1,
        exportedAt: new Date().toISOString(),
        orders,
        meta
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, `s45-orders-backup-${stamp}.json`);
      showToast(`Backup saved — ${orders.length} order${orders.length === 1 ? "" : "s"}`, "success");
    } catch (err) {
      console.error(err);
      showToast("Could not create backup", "error");
    } finally {
      el.btnBackup.disabled = false;
    }
  });

  el.btnRestore.addEventListener("click", () => {
    el.restoreFileInput.value = "";
    el.restoreFileInput.click();
  });

  el.restoreFileInput.addEventListener("change", async () => {
    const file = el.restoreFileInput.files && el.restoreFileInput.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (!payload || !Array.isArray(payload.orders)) {
        throw new Error("Not a valid S45 backup file");
      }
      const count = payload.orders.length;
      const ok = confirm(
        `Restore ${count} order${count === 1 ? "" : "s"} from this backup?\n\n` +
        `Any saved orders already on this device are kept — orders with a matching order number will be overwritten.`
      );
      if (!ok) return;

      // Restore by orderNumber (not raw id) so this works safely across
      // devices, where IndexedDB auto-increment ids won't line up.
      const existing = await DB.getAllOrders();
      const byOrderNumber = new Map(existing.map((o) => [o.orderNumber, o.id]));

      for (const order of payload.orders) {
        const clone = { ...order };
        const matchId = byOrderNumber.get(clone.orderNumber);
        if (matchId != null) {
          clone.id = matchId; // overwrite the existing local order with this number
        } else {
          delete clone.id; // let IndexedDB assign a fresh id
        }
        await DB.putOrder(clone);
      }
      if (Array.isArray(payload.meta)) {
        for (const m of payload.meta) {
          if (m && m.key) await DB.setMeta(m.key, m.value);
        }
      }
      await refreshBadge();
      if (el.drawer.classList.contains("open")) await populateDrawer(el.searchOrders.value);
      showToast("Backup restored", "success");
    } catch (err) {
      console.error(err);
      showToast("Could not restore this backup file", "error");
    }
  });

  el.btnEraseAll.addEventListener("click", async () => {
    const step1 = confirm(
      "Erase ALL saved orders from this device?\n\nThis cannot be undone. Tip: tap \"Backup Data\" first if you want to keep a copy."
    );
    if (!step1) return;
    const step2 = confirm("Are you absolutely sure? This will permanently delete every saved order on this device.");
    if (!step2) return;
    try {
      await DB.clearOrders();
      await DB.clearMeta();
      state.editingId = null;
      await startNewOrder();
      await refreshBadge();
      if (el.drawer.classList.contains("open")) await populateDrawer(el.searchOrders.value);
      showToast("All data erased", "success");
    } catch (err) {
      console.error(err);
      showToast("Could not erase data", "error");
    }
  });
  el.searchOrders.addEventListener("input", (e) => populateDrawer(e.target.value));

  /* ---------------- PDF Generation ---------------- */
  function buildPrintHTML(order) {
    const dt = order.deliveryDate
      ? new Date(order.deliveryDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
      : "—";
    const createdDt = new Date(order.createdAt || Date.now()).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

    const rows = order.items.map((it) => `
      <tr>
        <td class="center">${it.srNo}</td>
        <td>${escapeAttr(it.designNo) || "—"}</td>
        <td>${escapeAttr(it.particulars) || "—"}</td>
        <td>${escapeAttr(it.sizeChart) || "—"}</td>
        <td class="num">${it.price ? "₹" + it.price.toFixed(2) : "—"}</td>
      </tr>
    `).join("");

    return `
      <div class="pdfpage">
        <div class="pdf-border"></div>
        <div class="pdf-head">
          <div class="pdf-brand">
            <img src="${COMPANY.logo}" alt="logo" />
            <div>
              <h1>${COMPANY.name}</h1>
              <p>${COMPANY.firm}</p>
            </div>
          </div>
          <div class="pdf-firm">
            <strong>${COMPANY.firm}</strong>
            ${COMPANY.address}<br/>
            GSTIN: ${COMPANY.gstin}<br/>
            ${COMPANY.mobile} · ${COMPANY.website}
          </div>
        </div>

        <div class="pdf-metabar">
          <div><span>Order No.</span><strong>${escapeAttr(order.orderNumber)}</strong></div>
          <div><span>Order Date</span><strong>${createdDt}</strong></div>
          <div><span>Delivery Date</span><strong>${dt}</strong></div>
          <div><span>Agent / Distributor</span><strong>${escapeAttr(order.agentName) || "—"}</strong></div>
        </div>

        <div class="pdf-section-title">Party Details</div>
        <div class="pdf-party">
          <div><label>Party Name</label><div class="val">${escapeAttr(order.partyName) || "—"}</div></div>
          <div><label>Mobile Number</label><div class="val">${escapeAttr(order.partyMobile) || "—"}</div></div>
          <div class="full"><label>Address</label><div class="val">${escapeAttr(order.partyAddress) || "—"}</div></div>
          <div><label>GSTIN</label><div class="val">${escapeAttr(order.partyGSTIN) || "—"}</div></div>
        </div>

        <div class="pdf-section-title">Order Details</div>
        <table class="pdf-table">
          <thead>
            <tr>
              <th style="width:8%">Sr.</th>
              <th style="width:18%">Design No.</th>
              <th style="width:34%">Particulars</th>
              <th style="width:24%">Size Chart</th>
              <th style="width:16%">Price</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>

        <div class="pdf-totalrow">
          <span>Total Items: <strong>${order.items.length}</strong></span>
        </div>

        ${order.orderNotes ? `<div class="pdf-notes"><strong>Notes:</strong> ${escapeAttr(order.orderNotes)}</div>` : ""}

        <div class="pdf-sign">
          <div><div class="line"></div>Agent / Distributor Signature</div>
          <div><div class="line"></div>For ${COMPANY.firm}</div>
        </div>

        <div class="pdf-footer">
          <span>${COMPANY.name} · ${COMPANY.website}</span>
          <span>Generated ${new Date().toLocaleString("en-IN")}</span>
        </div>
      </div>
    `;
  }

  async function generatePdfBlob(order) {
    el.printRoot.innerHTML = buildPrintHTML(order);
    const pageEl = el.printRoot.querySelector(".pdfpage");

    // wait for logo image to load
    const img = pageEl.querySelector("img");
    if (img && !img.complete) {
      await new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; });
    }

    const canvas = await html2canvas(pageEl, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
    const imgData = canvas.toDataURL("image/jpeg", 0.95);

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    if (imgHeight <= pageHeight) {
      pdf.addImage(imgData, "JPEG", 0, 0, imgWidth, imgHeight);
    } else {
      // multi-page split if content overflows one A4 page
      let heightLeft = imgHeight;
      let position = 0;
      pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }
    }

    el.printRoot.innerHTML = "";
    return pdf.output("blob");
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  async function ensureSavedOrder() {
    // Save (or re-save) current form before exporting, so PDF matches what's saved.
    const saved = await saveOrder();
    return saved;
  }

  el.btnPdf.addEventListener("click", async () => {
    el.btnPdf.disabled = true;
    const original = el.btnPdf.textContent;
    el.btnPdf.textContent = "Generating…";
    try {
      const order = await ensureSavedOrder();
      if (!order) return;
      const blob = await generatePdfBlob(order);
      downloadBlob(blob, `${order.orderNumber.replace(/\//g, "-")}.pdf`);
      showToast("PDF downloaded", "success");
    } catch (err) {
      console.error(err);
      showToast("Could not generate PDF", "error");
    } finally {
      el.btnPdf.disabled = false;
      el.btnPdf.textContent = original;
    }
  });

  // navigator.share() must be invoked synchronously within a user gesture on
  // many mobile browsers (notably iOS Safari). Because building the PDF
  // (DB save + html2canvas render + jsPDF encode) takes real time, calling
  // share() *after* those awaits loses the gesture and throws
  // "NotAllowedError" on those browsers — that's why Share silently failed.
  //
  // Fix: tap 1 prepares & caches the PDF (async work happens here). Once
  // ready, the button relabels to "Tap to Share" — tap 2 calls
  // navigator.share() as the very first line of a fresh click handler, with
  // no awaits before it, so the gesture is still valid.
  let pendingShare = null; // { file, order }

  function resetShareButton() {
    pendingShare = null;
    el.btnShare.disabled = false;
    el.btnShare.textContent = "Share";
  }

  el.btnShare.addEventListener("click", async () => {
    // Step 2: PDF already prepared from a previous tap — share it immediately,
    // synchronously, with no intervening await.
    if (pendingShare) {
      const { file, order } = pendingShare;
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({
          files: [file],
          title: `Order ${order.orderNumber}`,
          text: `${COMPANY.name} — Order ${order.orderNumber} for ${order.partyName}`
        }).catch((err) => {
          if (err?.name !== "AbortError") {
            console.error(err);
            showToast("Could not share PDF", "error");
          }
        }).finally(resetShareButton);
      } else {
        downloadBlob(file, file.name);
        showToast("PDF downloaded (sharing files isn't supported here)");
        resetShareButton();
      }
      return;
    }

    // Step 1: prepare the PDF (this is where the async work / delay happens).
    el.btnShare.disabled = true;
    el.btnShare.textContent = "Preparing…";
    try {
      const order = await ensureSavedOrder();
      if (!order) { resetShareButton(); return; }
      const blob = await generatePdfBlob(order);
      const filename = `${order.orderNumber.replace(/\//g, "-")}.pdf`;
      const file = new File([blob], filename, { type: "application/pdf" });

      if (!navigator.share) {
        downloadBlob(blob, filename);
        showToast("PDF downloaded — sharing isn't supported on this browser");
        resetShareButton();
        return;
      }

      pendingShare = { file, order };
      el.btnShare.disabled = false;
      el.btnShare.textContent = "Tap to Share";
    } catch (err) {
      console.error(err);
      showToast("Could not prepare PDF", "error");
      resetShareButton();
    }
  });

  /* ---------------- Password Gate ----------------
     The password is fixed and stored only as a SHA-256 hash below (not in
     plain text) so it isn't trivially readable from the source file.
     Note: this is a client-side-only gate (no backend), so it deters casual
     access but is not real security - anyone with dev tools could bypass it.
  ------------------------------------------------- */
  const LOCK_SESSION_KEY = "s45_unlocked";
  const PASSWORD_HASH = "4e824ed4698a460dc6e180c8057f4136d02aa7aa8b4cd43203bd4d8191dff586";

  async function sha256Hex(text) {
    const enc = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function unlockApp() {
    el.lockScreen.hidden = true;
    el.lockScreen.style.display = "none";
    el.appRoot.hidden = false;
  }

  async function tryUnlock(pw) {
    const hash = await sha256Hex(pw);
    if (hash === PASSWORD_HASH) {
      try { sessionStorage.setItem(LOCK_SESSION_KEY, "1"); } catch (e) { /* ignore storage errors */ }
      el.lockError.hidden = true;
      unlockApp();
      init();
      return true;
    }
    el.lockError.hidden = false;
    el.lockPassword.value = "";
    el.lockPassword.focus();
    return false;
  }

  el.lockForm.addEventListener("submit", (e) => {
    e.preventDefault();
    tryUnlock(el.lockPassword.value);
  });

  el.lockToggle.addEventListener("click", () => {
    const isPw = el.lockPassword.type === "password";
    el.lockPassword.type = isPw ? "text" : "password";
    el.lockToggle.setAttribute("aria-label", isPw ? "Hide password" : "Show password");
  });

  /* ---------------- Init ---------------- */
  async function init() {
    state.items = [newItem()];
    renderItems();
    el.orderNumber.textContent = await peekNextOrderNumber();
    await refreshBadge();

    // Default delivery date = 7 days from now
    const d = new Date();
    d.setDate(d.getDate() + 7);
    el.deliveryDate.value = d.toISOString().slice(0, 10);

    // Register service worker for installability / offline support
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("service-worker.js").catch((e) => console.warn("SW registration failed", e));
      });
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    let alreadyUnlocked = false;
    try { alreadyUnlocked = sessionStorage.getItem(LOCK_SESSION_KEY) === "1"; } catch (e) { /* ignore */ }

    if (alreadyUnlocked) {
      unlockApp();
      init();
    } else {
      el.lockPassword.focus();
    }
  });
})();
