import React from "react";

// Standardized typography tokens for consistent headers/labels
const UI = {
  label: "mb-3 text-sm font-semibold text-gray-900",
  value: "text-sm text-gray-900",
};

/**
 * ChatBox
 * - Clear presentation of Customer, Ship To, Items (with quantity controls), and Notes
 * - Supports image lightbox
 * - If `orders` exist, renders detailed sales orders; otherwise falls back to a simple items list
 */

export default function ChatBox({
  items = [],
  orders = [],
  images = [],
  loading = false,
  error = null,
  companyName,
  country,
  region,
  customerOptions = [],
  selectedCustomers = [],
  onSearchCustomer,
  onSelectCustomer,
  itemOptions = [],
  selectedItems = [],
  onSearchItem,
  onSelectItem,
  courierFee,
  onCommentChange
}) {
  const [lightbox, setLightbox] = React.useState(null);
  const [qtyMap, setQtyMap] = React.useState({});
  const [typedNames, setTypedNames] = React.useState([]);
  const [itemQueries, setItemQueries] = React.useState({});
  const [comments, setComments] = React.useState([]);
  const [orderItems, setOrderItems] = React.useState([]); // per-order editable rows
  const [externalDocs, setExternalDocs] = React.useState([]);
  const [submitting, setSubmitting] = React.useState({});
  const [submitMsg, setSubmitMsg] = React.useState({});

  // Handle lightbox open/close and document scroll lock
  React.useEffect(() => {
    if (!lightbox) return;
    const onKey = (e) => e.key === "Escape" && setLightbox(null);
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [lightbox]);

  // Set order items
  React.useEffect(() => {
    setOrderItems((orders || []).map((o) => Array.isArray(o.items) ? [...o.items] : []));
  }, [orders]);

  React.useEffect(() => {
    if (!Array.isArray(orders)) return;
    const names = [];
    orders.forEach((so, oIdx) => {
      names[oIdx] = so?.customer_name || "";
    });
    setTypedNames(names);
    setOrderItems(
      orders.map((so) => (Array.isArray(so?.items) ? [...so.items] : []))
    );
    setComments((orders || []).map(() => ""));
  }, [orders]);

  // Rebuild qty map whenever editable orderItems change
  React.useEffect(() => {
    if (!Array.isArray(orderItems) || !Array.isArray(orders)) return;
    const next = {};
    orders.forEach((so, oIdx) => {
      const orderKey = so?.id ?? so?.external_document_number ?? oIdx;
      (orderItems?.[oIdx] || []).forEach((it, iIdx) => {
        const itemKey = it?.id ?? `${orderKey}-${iIdx}`;
        const key = `${orderKey}::${itemKey}`;
        const raw = it?.quantity;
        const n = typeof raw === 'number' ? raw : parseFloat(raw);
        next[key] = Number.isFinite(n) ? n : 0;
      });
    });
    setQtyMap(next);
  }, [orderItems, orders]);

  React.useEffect(() => {
    setExternalDocs((orders || []).map(o => o?.external_document_number ?? ""));
  }, [orders]);

  const addItem = (orderIndex) => {
    setOrderItems((prev) => {
      const next = prev.map((rows) => (rows ? rows.slice() : []));
      const rows = next[orderIndex] || [];
      rows.push({ name: "", quantity: 1 });
      next[orderIndex] = rows;
      return next;
    });
  };

  const removeItem = (orderIndex, itemIndex) => {
    setOrderItems((prev) => {
      const next = prev.map((rows) => (rows ? rows.slice() : []));
      const rows = (next[orderIndex] || []).slice();
      rows.splice(itemIndex, 1);
      next[orderIndex] = rows;
      return next;
    });
  };

  // Auto-add/remove a courier line based on total qty and fee
  React.useEffect(() => {
    if (!Array.isArray(orderItems)) return;
    // Only run if we have a numeric/defined fee; otherwise do nothing
    const fee = typeof courierFee === 'number' ? courierFee : (courierFee == null ? null : Number(courierFee));
    if (fee == null) return;
    let mutated = false;
    const next = orderItems.map((rows, oIdx) => {
      const current = Array.isArray(rows) ? rows.slice() : [];
      // Sum quantities for this order
      let total = 0;
      current.forEach((rit, rIdx) => {
        // Exclude the synthetic courier row from the product total
        if (rit && rit.__courier) return;
        const so = orders?.[oIdx];
        const k = getKey(so, oIdx, rit, rIdx);
        const raw = qtyMap[k] ?? rit?.quantity ?? 0;
        const n = typeof raw === 'number' ? raw : parseFloat(raw);
        total += Number.isFinite(n) ? n : 0;
      });
      const hasCourier = current.some((r) => r && r.__courier === true);
      if (total <= 2) {
        if (!hasCourier) {
          mutated = true;
          current.push({ name: 'Courier Fee', quantity: 1, __courier: true });
        }
      } else if (hasCourier) {
        mutated = true;
        return current.filter((r) => !r.__courier);
      }
      return current;
    });
    if (mutated) setOrderItems(next);
  }, [orderItems, qtyMap, courierFee, orders]);

  const getKey = (so, oIdx, it, iIdx) => {
    const orderKey = so?.id ?? so?.external_document_number ?? oIdx;
    const itemKey = it?.id ?? `${orderKey}-${iIdx}`;
    return `${orderKey}::${itemKey}`;
  };
  const STEP = 0.5;
  const toNum = (v) => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const s = v.replace(',', '.').trim();
      const n = Number(s);
      return Number.isFinite(n) ? n : 0;
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const setQty = (key, val) =>
    setQtyMap((prev) => ({ ...prev, [key]: Math.max(0, toNum(val)) }));

  const incQty = (key) =>
    setQty(key, toNum(qtyMap[key] ?? 0) + STEP);

  const decQty = (key) =>
    setQty(key, toNum(qtyMap[key] ?? 0) - STEP);

  // Keep orderItems in sync when qty changes from UI
  const updateQtyForRow = (oIdx, iIdx, val) => {
    const so = orders?.[oIdx];
    const rows = orderItems?.[oIdx] || [];
    const item = rows[iIdx] || {};
    const key = getKey(so, oIdx, item, iIdx);
    const n = Math.max(0, toNum(val));
    setQtyMap((prev) => ({ ...prev, [key]: n }));
    setOrderItems((prev) => {
      const next = prev.map((r) => (r ? r.slice() : []));
      const rws = next[oIdx] || [];
      const row = { ...(rws[iIdx] || {}), quantity: n };
      rws[iIdx] = row;
      next[oIdx] = rws;
      return next;
    });
  };

  // Determine Shipping Method (Code, Agent) based on form folder location
  const getShippingByLocation = React.useCallback(() => {
    const c = (country || "").toUpperCase().trim();
    const r = (region || "").toLowerCase();
    // Country-wide overrides
    if (c === "SG") return { code: "Transport", agent: "Ter Chong" };
    if (c === "VN") return { code: "Own Logistics", agent: "Own Logistics" };
    // Region heuristics (Malaysia regions typically)
    if (r.includes("central") || r.includes("kl")) {
      return { code: "Own Logistics", agent: "Own Logistics" };
    }
    if (r.includes("north") || r.includes("east")) {
      return { code: "Courier", agent: "DHL" };
    }
    if (r.includes("south")) {
      return { code: "Transport", agent: "Ter Chong" };
    }
    return { code: "", agent: "" };
  }, [country, region]);

  const getCustomerOptions = (idx) => {
    const opts = customerOptions?.[idx];
    if (!opts) return [];
    if (Array.isArray(opts?.results)) return opts.results;
    return Array.isArray(opts) ? opts : [];
  };

  const getItemOptions = (oIdx, iIdx) => {
    const row = itemOptions?.[oIdx];
    const list = Array.isArray(row) ? row[iIdx] : undefined;
    return Array.isArray(list) ? list : [];
  };

  const validateAndBuildPayload = (oIdx) => {
    const so = orders?.[oIdx] || {};
    if (!companyName) {
      return { ok: false, message: "Select a company first." };
    }
    const customer = selectedCustomers?.[oIdx] || null;
    const custOptions = getCustomerOptions(oIdx);
    if (!customer || !customer.number) {
      return { ok: false, message: "Select a valid customer from suggestions." };
    }
    const custInList = custOptions.some((c) => (c.number || "") === customer.number);
    if (!custInList) {
      return { ok: false, message: "Selected customer is not from the fetched list." };
    }

    const rows = orderItems?.[oIdx] || [];
    const selectedForOrder = selectedItems?.[oIdx] || [];
    const sales_order_lines = [];
    for (let iIdx = 0; iIdx < rows.length; iIdx++) {
      const row = rows[iIdx] || {};
      if (row.__courier) continue; // skip synthetic courier row
      const chosen = selectedForOrder[iIdx] || null;
      const options = getItemOptions(oIdx, iIdx);
      if (!chosen || !chosen.number) {
        return { ok: false, message: `Row ${iIdx + 1}: select a valid item.` };
      }
      const inList = options.some((o) => (o.number || "") === chosen.number);
      if (!inList) {
        return { ok: false, message: `Row ${iIdx + 1}: item not from fetched list.` };
      }
      const rawQty = row?.quantity;
      const qty = typeof rawQty === 'number' ? rawQty : Number(rawQty);
      if (!Number.isFinite(qty) || qty <= 0) {
        return { ok: false, message: `Row ${iIdx + 1}: quantity must be > 0.` };
      }
      sales_order_lines.push({ lineObjectNumber: chosen.number, quantity: qty });
    }
    if (sales_order_lines.length === 0) {
      return { ok: false, message: "Add at least one valid item line." };
    }

    return {
      ok: true,
      payload: {
        company_name: companyName || "",
        customer_id: customer.number,
        external_doc_no: externalDocs?.[oIdx] || "",
        sales_order_lines,
        comments: comments?.[oIdx] || "",
      },
    };
  };

  const insertSO = async (oIdx) => {
    setSubmitMsg((m) => ({ ...m, [oIdx]: "" }));
    const v = validateAndBuildPayload(oIdx);
    if (!v.ok) {
      setSubmitMsg((m) => ({ ...m, [oIdx]: v.message }));
      return;
    }
    try {
      setSubmitting((s) => ({ ...s, [oIdx]: true }));
      const res = await fetch(
        `${import.meta?.env?.VITE_API_BASE_URL || 'http://localhost:8000'}/api/insert_so_into_bc`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(v.payload),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data?.status === 'success' || data?.status === 'ok')) {
        setSubmitMsg((m) => ({ ...m, [oIdx]: 'Inserted successfully.' }));
      } else {
        const msg = data?.message || data?.details || 'Insert failed.';
        setSubmitMsg((m) => ({ ...m, [oIdx]: msg }));
      }
    } catch (e) {
      setSubmitMsg((m) => ({ ...m, [oIdx]: String(e?.message || e) }));
    } finally {
      setSubmitting((s) => ({ ...s, [oIdx]: false }));
    }
  };


  // 1) Loading state
  if (loading) {
    return <div className="p-4 text-gray-600">Loading...</div>;
  }

  // 2) Error state (handle string or Error object)
  if (error) {
    const message =
      typeof error === "string" ? error : error?.message ?? JSON.stringify(error);
    return <div className="p-4 text-red-600">Error: {message}</div>;
  }

  // 3) Preferred view: render sales orders when available
  if (Array.isArray(orders) && orders.length > 0) {
    return (
      <>
        <div className="flex-1 p-4 overflow-y-auto">
          <ul className="space-y-3">
            {orders.map((so, idx) => (
              <li
                key={so?.id ?? so?.external_document_number ?? idx}
                className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
              >
                {/* Image + Details layout */}
                <div className="mt-3 md:flex md:gap-6">
                  {/* Left: Image */}
                  <div className="md:w-96 md:flex-shrink-0">
                    {/* Image */}
                    {(() => {
                      const img = images?.[idx];
                      let src = null;
                      if (typeof img === "string") {
                        src = img.startsWith("data:") ? img : `data:image/png;base64,${img}`;
                      } else if (img && typeof img === "object") {
                        if (img.base64) {
                          src = `data:${img.mime || "image/png"};base64,${img.base64}`;
                        } else if (img.url) {
                          src = img.url;
                        }
                      }
                      return src ? (
                        <div>
                          <div
                            className="group inline-block w-full h-[24rem] overflow-hidden rounded border border-gray-200 bg-white flex items-center justify-center"
                            role="button"
                            tabIndex={0}
                            onClick={() =>
                              setLightbox({ src, alt: `${so?.customer_name || "Order"} image` })
                            }
                            onKeyDown={(e) =>
                              (e.key === "Enter" || e.key === " ") &&
                              setLightbox({ src, alt: `${so?.customer_name || "Order"} image` })
                            }
                          >
                            <img
                              src={src}
                              alt={`${so?.customer_name || "Order"} image`}
                              className="block w-full h-full object-contain transform-gpu transition-transform duration-300 ease-out group-hover:scale-[1.02] cursor-zoom-in outline-none focus:outline-none focus:ring-0"
                              loading="lazy"
                            />
                          </div>
                        </div>
                      ) : null;
                    })()}
                  </div>
                  {/* Right: Details (customer, items, notes) */}
                  {/* Customer, ship-to and PO */}
                  <div className="flex-1 space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6">
                      <div>
                        <p className={UI.label}>Customer Name</p>
                        {/* Force two rows: 1) dropdown, 2) input + button */}
                        <div className="grid grid-cols-1 gap-2">
                          {(() => {
                            const options = Array.isArray(customerOptions?.[idx]?.results)
                              ? customerOptions[idx].results
                              : customerOptions?.[idx] || [];
                            const valueNumber = selectedCustomers?.[idx]?.number || "";
                            const handleSelect = (e) => {
                              const num = e.target.value;
                              const chosen = options.find((c) => (c.number || "") === num) || null;
                              onSelectCustomer?.(idx, chosen);
                            };
                            return (
                              <>
                                <div>
                                  <select
                                    value={valueNumber}
                                    onChange={handleSelect}
                                    className="h-9 w-100 rounded border border-gray-300 bg-white px-2 text-sm text-gray-900"
                                  >
                                    <option value="">{so?.customer_name || "-"}</option>
                                    {options.map((c) => (
                                      <option key={(c.number || c.displayName)} value={c.number || ""}>
                                        {(c.displayName || c.number) + (c.number ? ` (${c.number})` : "")}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                <div className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={typedNames[idx] ?? ""}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      setTypedNames((prev) => {
                                        const n = prev.slice();
                                        n[idx] = v;
                                        return n;
                                      });
                                    }}
                                    placeholder="Search name..."
                                    className="h-9 w-68 rounded border border-gray-300 px-2 text-sm text-gray-900"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => onSearchCustomer?.(idx, typedNames[idx] || so?.customer_name || "")}
                                    className="h-9 rounded bg-gray-500 px-3 text-sm font-medium text-white hover:bg-gray-600 cursor-pointer"
                                  >
                                    Find Customer
                                  </button>
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                      <div>
                        <p className={UI.label}>External Document No</p>
                        <input
                          type="text"
                          value={externalDocs[idx] ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            setExternalDocs(prev => {
                              const next = prev.slice();
                              next[idx] = v;
                              return next;
                            });
                            onExternalDocChange?.(idx, v); // optional, see step 3
                          }}
                          placeholder="-"
                          className="h-9 w-full max-w-[20rem] rounded border border-gray-300 px-2 text-sm text-gray-900"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <p className={UI.label}>Ship To</p>
                        {/* TODO: Update the shipping address linked with the current customer (reAct) */}
                        <p className={UI.value}>{so?.shipping_address || "-"}</p>
                      </div>

                      {/* Shipping Method (Code & Agent) derived from form folder name (country/region) */}
                      <div>
                        <p className={UI.label}>Shipping Method</p>
                        {(() => {
                          const ship = getShippingByLocation();
                          return (
                            <div className="grid grid-cols-2 gap-4 text-sm">
                              <div>
                                <div className="text-gray-600">Code</div>
                                <div className="text-gray-900">{ship.code || '-'}</div>
                              </div>
                              <div>
                                <div className="text-gray-600">Agent</div>
                                <div className="text-gray-900">{ship.agent || '-'}</div>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                      {selectedCustomers?.[idx] ? (
                        <div className="sm:col-span-2">
                          <p className={UI.label}>Customer Details</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 text-sm text-gray-900">
                            <div>
                              <div className="mt-2 grid grid-cols-[140px_1fr] gap-y-1 text-sm">
                                <div className="text-gray-600">Customer No.</div>
                                <div className="text-gray-900">{selectedCustomers[idx]?.number || "-"}</div>
                                <div className="text-gray-600">Email</div>
                                <div className="text-gray-900">{selectedCustomers[idx]?.email || "-"}</div>
                                <div className="text-gray-600">Phone</div>
                                <div className="text-gray-900">{selectedCustomers[idx]?.phoneNumber || "-"}</div>
                              </div>
                            </div>
                            <div>
                              <div className="text-gray-600">Address</div>
                              <div className="text-gray-900">{selectedCustomers[idx]?.addressLine1 || ""}</div>
                              <div className="text-gray-900">{selectedCustomers[idx]?.addressLine2 || ""}</div>
                              <div className="text-gray-900">
                                {[selectedCustomers[idx]?.postalCode, selectedCustomers[idx]?.city, selectedCustomers[idx]?.state]
                                  .filter(Boolean)
                                  .join(" ")}
                                {selectedCustomers[idx]?.country ? `, ${selectedCustomers[idx].country}` : ""}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {/* Items */}
                    <div className="mt-3">
                      <p className={UI.label}>Items</p>
                      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
                        {Array.isArray(so?.items) && so.items.length > 0 ? (
                          <table className="min-w-full divide-y divide-gray-200 text-sm">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-3 py-2 text-left font-semibold text-gray-700">Item</th>
                                <th className="px-3 py-2 text-left font-semibold text-gray-700 w-36">Category</th>
                                <th className="px-3 py-2 text-right font-semibold text-gray-700 w-36">Unit Price</th>
                                <th className="pl-3 pr-2 py-2 text-center font-semibold text-gray-700 w-40">Qty (m)</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {(orderItems?.[idx] || []).map((it, iidx) => {
                                const qKey = getKey(so, idx, it, iidx);
                                const qty = qtyMap[qKey] ?? (it?.quantity ?? 0);
                                return (
                                  <tr key={it?.id ?? iidx}>
                                    <td className="px-3 py-2 align-middle">
                                      {(() => {
                                        const options = itemOptions?.[idx]?.[iidx] || [];
                                        const sel = selectedItems?.[idx]?.[iidx] || null;
                                        const selValue = sel?.number || "";
                                        const key = `${idx}:${iidx}`;
                                        const qv = itemQueries[key] ?? "";
                                        return (
                                          <div className="space-y-2 max-w-[48rem]">
                                            <select
                                              value={selValue}
                                              onChange={(e) => {
                                                const num = e.target.value;
                                                const chosen = options.find((o) => (o.number || "") === num) || null;
                                                onSelectItem?.(idx, iidx, chosen);
                                              }}
                                              className="h-9 w-90 rounded border border-gray-300 bg-white px-2 text-sm text-gray-900"
                                            >
                                              <option value="">{it?.fabric_name || it?.name || "-"}</option>
                                              {options.map((o) => (
                                                <option key={o.number || o.displayName} value={o.number || ""}>
                                                  {(o.displayName || o.number) + (o.number ? ` (${o.number})` : "")}
                                                </option>
                                              ))}
                                            </select>
                                            <div className="flex items-center gap-2">
                                              <input
                                                type="text"
                                                value={qv}
                                                onChange={(e) =>
                                                  setItemQueries((prev) => ({ ...prev, [key]: e.target.value }))
                                                }
                                                placeholder="Search item…"
                                                className="h-9 w-67 rounded border border-gray-300 px-2 text-sm text-gray-900"
                                              />
                                              <button
                                                type="button"
                                                onClick={() => onSearchItem?.(idx, iidx, qv || it?.fabric_name || it?.name || "")}
                                                className="h-9 rounded bg-gray-500 px-3 text-sm font-medium text-white hover:bg-gray-600 cursor-pointer"
                                              >
                                                Find Item
                                              </button>
                                            </div>
                                          </div>
                                        );
                                      })()}
                                    </td>
                                    <td className="px-3 py-2 align-middle text-sm text-gray-900">
                                      {selectedItems?.[idx]?.[iidx]?.itemCategoryCode || "-"}
                                    </td>
                                    <td className="px-3 py-2 align-middle text-right text-sm text-gray-900 cursor-pointer">
                                      {typeof selectedItems?.[idx]?.[iidx]?.unitPrice === 'number'
                                        ? selectedItems[idx][iidx].unitPrice.toFixed(2)
                                        : "-"}
                                    </td>
                                    <td className="px-3 py-2 align-middle">
                                      <div className="flex items-center justify-end">
                                        <button
                                          type="button"
                                          aria-label="Decrease quantity"
                                          onClick={() => updateQtyForRow(idx, iidx, toNum(qty) - STEP)}
                                          className="h-8 w-8 rounded-l border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 cursor-pointer"
                                        >
                                          -
                                        </button>
                                        <input
                                          type="number"
                                          min={0}
                                          step={STEP}
                                          inputMode="decimal"
                                          value={qty}
                                          onChange={(e) => updateQtyForRow(idx, iidx, e.target.value)}
                                          className="h-8 w-16 border-y border-gray-200 text-center text-sm focus:outline-none"
                                        />
                                        <button
                                          type="button"
                                          aria-label="Increase quantity"
                                          onClick={() => updateQtyForRow(idx, iidx, toNum(qty) + STEP)}
                                          className="h-8 w-8 rounded-r border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 cursor-pointer"
                                        >
                                          +
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => removeItem(idx, iidx)}
                                          className="ml-2 h-8 px-2 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer"
                                        >
                                          -
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        ) : (
                          <div className="px-3 py-2 text-sm text-gray-500">No items detected. Please review the screenshot or add items manually.</div>
                        )}

                        <div className="px-3 py-2 flex justify-end">
                          <button
                            type="button"
                            onClick={() => addItem(idx)}
                            className="inline-flex items-center px-3 py-2 text-xs text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 cursor-pointer"
                          >
                            + Add Item
                          </button>
                        </div>
                      </div>

                      {(() => {
                        const rows = orderItems?.[idx] || [];
                        let total = 0;
                        rows.forEach((rit, rIdx) => {
                          const k = getKey(so, idx, rit, rIdx);
                          const raw = qtyMap[k] ?? rit?.quantity ?? 0;
                          const n = typeof raw === 'number' ? raw : parseFloat(raw);
                          total += Number.isFinite(n) ? n : 0;
                        });
                        if (courierFee != null && total <= 2) {
                          const feeText = typeof courierFee === 'number' ? courierFee.toFixed(2) : String(courierFee);
                          return (
                            <div className="px-3 pb-2 flex justify-end">
                              <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                                Courier Fee applies (≤ 2 m): {feeText}
                              </div>
                            </div>
                          );
                        }
                        return null;
                      })()}

                    </div>

                    {/* Notes */}
                    {so?.notes ? (
                      <div className="mt-3">
                        <p className={UI.label}>Notes</p>
                        <div className="whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 shadow-sm">
                          {so.notes}
                        </div>
                      </div>
                    ) : null}

                {/* Comments */}
                <div className="mt-3">
                  <p className={UI.label}>Comments</p>
                  <textarea
                        value={comments[idx] ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          setComments((prev) => {
                            const next = prev.slice();
                            next[idx] = v;
                            return next;
                          });
                          onCommentChange?.(idx, v);
                        }}
                        placeholder="Add any remarks or special instructions…"
                        rows={3}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                  />
                </div>

                {/* Insert SO Action */}
                <div className="mt-4 flex items-center justify-between">
                  <div className="text-sm text-red-600">{submitMsg[idx] || ''}</div>
                  <button
                    type="button"
                    disabled={!!submitting[idx]}
                    onClick={() => insertSO(idx)}
                    className={`h-10 rounded px-4 text-sm font-medium text-white cursor-pointer ${submitting[idx] ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}
                  >
                    {submitting[idx] ? 'Inserting…' : 'Insert SO'}
                  </button>
                </div>

                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
        {lightbox && (
          <div className="fixed inset-0 z-50 bg-black/70" onClick={() => setLightbox(null)}>
            <div
              className="absolute inset-0 flex items-center justify-center p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={lightbox.src}
                alt={lightbox.alt || "Image preview"}
                className="max-w-[95vw] max-h-[90vh] object-contain rounded shadow-2xl cursor-zoom-out"
                onClick={() => setLightbox(null)}
              />
              <button
                type="button"
                onClick={() => setLightbox(null)}
                className="absolute top-4 right-4 rounded bg-white/90 px-3 py-1 text-sm font-medium shadow hover:bg-white"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  // 4) Fallback view: simple list of items
  if (!Array.isArray(items) || items.length === 0) {
    return <div className="p-4 text-gray-500">No items to display</div>;
  }

  return (
    <>
      <div className="flex-1 p-4 overflow-y-auto">
        <ul className="space-y-1">
          {items.map((it, i) => {
            const isString = typeof it === "string";
            const key = isString ? `${it}-${i}` : it?.id ?? it?.name ?? i;
            const label = isString ? it : it?.name ?? it?.fabric_name ?? String(it);
            return (
              <li key={key} className="rounded border bg-white px-3 py-2">
                {label}
              </li>
            );
          })}
        </ul>
      </div>
      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/70" onClick={() => setLightbox(null)}>
          <div
            className="absolute inset-0 flex items-center justify-center p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={lightbox.src}
              alt={lightbox.alt || "Image preview"}
              className="max-w-[95vw] max-h-[90vh] object-contain rounded shadow-2xl cursor-zoom-out"
              onClick={() => setLightbox(null)}
            />
            <button
              type="button"
              onClick={() => setLightbox(null)}
              className="absolute top-4 right-4 rounded bg-white/90 px-3 py-1 text-sm font-medium shadow hover:bg-white"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}






