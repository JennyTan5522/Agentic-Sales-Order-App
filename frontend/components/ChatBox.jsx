import React from "react";

// Standardized typography tokens for consistent headers/labels
const UI = {
  label: "mb-3 text-sm font-semibold text-gray-900",
  value: "text-sm text-gray-900",
};

// const API_BASE = import.meta?.env?.VITE_API_BASE_URL || 'http://localhost:8000';
const API_BASE = 'http://localhost:8001';

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
  const [lotsByOrder, setLotsByOrder] = React.useState({});   // { [orderIndex]: Lot[] }
  const [lotsLoading, setLotsLoading] = React.useState({});   // { [orderIndex]: boolean }
  const [lotsError, setLotsError] = React.useState({});       // { [orderIndex]: string }
  const [soInserted, setSoInserted] = React.useState({});
  const [salesOrderNoByIndex, setSalesOrderNoByIndex] = React.useState({});
  const [lotsInserted, setLotsInserted] = React.useState({});
  const [insertLotsSubmitting, setInsertLotsSubmitting] = React.useState({});
  const [insertLotsMsg, setInsertLotsMsg] = React.useState({});
  const [expandedLots, setExpandedLots] = React.useState({});
  const [shipmentMethods, setShipmentMethods] = React.useState([]);
  const [shipmentAgents, setShipmentAgents] = React.useState([]);

  // Per-order shipping selection: { [orderIndex]: methodId / agentCode }
  const [shipmentMethodIdByOrder, setShipmentMethodIdByOrder] = React.useState({});
  const [shipmentAgentCodeByOrder, setShipmentAgentCodeByOrder] = React.useState({});

  // Shipping & Billing address modes and values (per order)  { [orderIndex]: 'DEFAULT' | 'CUSTOM' }
  const [shipToTypeByOrder, setShipToTypeByOrder] = React.useState({});
  const [billToTypeByOrder, setBillToTypeByOrder] = React.useState({});

  // Per-line pricing & discount
  const [linePricingByOrder, setLinePricingByOrder] = React.useState({});   // { [orderIndex]: { [itemIndex]: { unitPrice, unitOfMeasureCode, itemNo } } }
  const [lineDiscountByOrder, setLineDiscountByOrder] = React.useState({}); // { [orderIndex]: { [itemIndex]: number } } – discount in %

  // Custom address values (only used when type = CUSTOM)
  const [shipToAddressByOrder, setShipToAddressByOrder] = React.useState({}); // { [orderIndex]: { addressLine1, addressLine2, city, state, postalCode, country } }
  const [billToAddressByOrder, setBillToAddressByOrder] = React.useState({});

  const isSOReadOnly = (oIdx) => !!soInserted[oIdx];

  const toggleLots = (key) => {
    setExpandedLots((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

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

  // Set PO Number
  React.useEffect(() => {
    setExternalDocs((orders || []).map(o => o?.external_document_number ?? ""));
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

  // Fetch shipment methods & agents from backend when company changes
  React.useEffect(() => {
    if (!companyName) {
      setShipmentMethods([]);
      setShipmentAgents([]);
      setShipmentMethodIdByOrder({});
      setShipmentAgentCodeByOrder({});
      return;
    }

    const fetchShippingMeta = async () => {
      try {
        console.log("[Shipping] Fetching methods/agents for:", companyName);

        const [methodRes, agentRes] = await Promise.all([
          fetch(`${API_BASE}/api/get_shipment_methods?company_name=${encodeURIComponent(companyName)}`),
          fetch(`${API_BASE}/api/get_shipment_agents?company_name=${encodeURIComponent(companyName)}`),
        ]);

        const methodData = await methodRes.json().catch(() => ({}));
        const agentData = await agentRes.json().catch(() => ({}));

        const methods =
          methodData?.status === "success" && Array.isArray(methodData?.shipment_methods)
            ? methodData.shipment_methods
            : [];

        const agents =
          agentData?.status === "success" && Array.isArray(agentData?.shipment_agents)
            ? agentData.shipment_agents
            : [];

        setShipmentMethods(methods);
        setShipmentAgents(agents);
      } catch (e) {
        console.error("Failed to load shipment methods/agents:", e);
        setShipmentMethods([]);
        setShipmentAgents([]);
      }
    };

    fetchShippingMeta();
  }, [companyName]);

  // Auto select default shipping method/agent PER ORDER, based on country/region
  React.useEffect(() => {
    if (!country && !region) return;
    if (!shipmentMethods.length && !shipmentAgents.length) return;
    if (!orders || !orders.length) return;

    const c = (country || "").toUpperCase().trim();
    const r = (region || "").toLowerCase();

    // Human names for mapping to BC data
    let defaultMethodName = "";
    let defaultAgentName = "";

    // Country-wide overrides
    if (c === "SG") {
      defaultMethodName = "Transport";
      defaultAgentName = "Ter Chong";
    } else if (c === "VN") {
      defaultMethodName = "Own Logistics";
      defaultAgentName = "Own Logistics";
    } else if (r.includes("central") || r.includes("kl")) {
      defaultMethodName = "Own Logistics";
      defaultAgentName = "Own Logistics";
    } else if (r.includes("north") || r.includes("east")) {
      defaultMethodName = "Courier";
      defaultAgentName = "DHL";
    } else if (r.includes("south")) {
      defaultMethodName = "Transport";
      defaultAgentName = "Ter Chong";
    }

    // Resolve default methodId from BC shipmentMethods
    let defaultMethodId = "";
    if (defaultMethodName && shipmentMethods.length > 0) {
      const lower = defaultMethodName.toLowerCase();
      const methodObj =
        shipmentMethods.find(
          (m) =>
            m.displayName?.toLowerCase().includes(lower) ||
            m.code?.toLowerCase().includes(lower)
        ) || null;
      if (methodObj?.id) defaultMethodId = methodObj.id;
    }

    // Resolve default agentCode from BC shipmentAgents
    let defaultAgentCode = "";
    if (defaultAgentName && shipmentAgents.length > 0) {
      const lower = defaultAgentName.toLowerCase();
      const agentObj =
        shipmentAgents.find(
          (a) =>
            a.Name?.toLowerCase().includes(lower) ||
            a.Code?.toLowerCase().includes(lower)
        ) || null;
      if (agentObj?.Code) defaultAgentCode = agentObj.Code;
    }

    if (!defaultMethodId && !defaultAgentCode) return;

    // Fill defaults for orders that don't have a selection yet
    setShipmentMethodIdByOrder((prev) => {
      const next = { ...prev };
      orders.forEach((_, idx) => {
        if (!next[idx] && defaultMethodId) {
          next[idx] = defaultMethodId;
        }
      });
      return next;
    });

    setShipmentAgentCodeByOrder((prev) => {
      const next = { ...prev };
      orders.forEach((_, idx) => {
        if (!next[idx] && defaultAgentCode) {
          next[idx] = defaultAgentCode;
        }
      });
      return next;
    });
  }, [country, region, shipmentMethods, shipmentAgents, orders]);

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

  // Fetch item price from backend
  const fetchLinePrice = async (orderIndex, itemIndex, itemNo) => {
    if (!companyName || !itemNo) return;

    try {
      const params = new URLSearchParams({
        company_name: companyName,
        item_no: itemNo,
      }).toString();

      const res = await fetch(`${API_BASE}/api/get_item_price_details?${params}`);
      const data = await res.json().catch(() => null);

      if (!data) return;

      setLinePricingByOrder((prev) => {
        const next = { ...prev };
        const orderMap = { ...(next[orderIndex] || {}) };
        orderMap[itemIndex] = {
          itemNo,
          unitPrice: typeof data.unitPrice === "number" ? data.unitPrice : 0,
          unitOfMeasureCode: data.unitOfMeasureCode || "",
        };
        next[orderIndex] = orderMap;
        return next;
      });
    } catch (e) {
      console.error("Failed to fetch line price:", e);
    }
  };

  // Auto fetch price when selected item changes
  React.useEffect(() => {
    if (!companyName || !Array.isArray(selectedItems)) return;

    selectedItems.forEach((orderRow, oIdx) => {
      (orderRow || []).forEach((sel, iIdx) => {
        const itemNo = sel?.number;
        if (!itemNo) return;

        const existing = linePricingByOrder[oIdx]?.[iIdx];
        // Avoid refetch if we already have price for this itemNo
        if (existing && existing.itemNo === itemNo) return;

        fetchLinePrice(oIdx, iIdx, itemNo);
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItems, companyName]);

  // Helper to read price & discount in one place
  const getLinePricing = (orderIndex, itemIndex) => {
    const orderMap = linePricingByOrder[orderIndex] || {};
    return orderMap[itemIndex] || {};
  };

  const getLineDiscountPercent = (orderIndex, itemIndex) => {
    const orderMap = lineDiscountByOrder[orderIndex] || {};
    const v = orderMap[itemIndex];
    return typeof v === "number" ? v : 0;
  };

  const setLineDiscountPercent = (orderIndex, itemIndex, val) => {
    const n = Number(val);
    const pct = Number.isFinite(n) ? Math.max(0, n) : 0;
    setLineDiscountByOrder((prev) => {
      const next = { ...prev };
      const orderMap = { ...(next[orderIndex] || {}) };
      orderMap[itemIndex] = pct;
      next[orderIndex] = orderMap;
      return next;
    });
  };

  const handleShippingTypeChange = (orderIndex, which, value) => {
    const so = orders?.[orderIndex] || {};

    if (which === "shipTo") {
      setShipToTypeByOrder((prev) => ({
        ...prev,
        [orderIndex]: value,
      }));

      if (value === "CUSTOM") {
        setShipToAddressByOrder((prev) => ({
          ...prev,
          [orderIndex]: {
            addressLine1: so.shipping_address_line1 || so.shipping_address || "",
            addressLine2: so.shipping_address_line2 || "",
            city: so.shipping_city || "",
            state: so.shipping_state || "",
            postalCode: so.shipping_postalCode || "",
            country: so.shipping_country || "",
          },
        }));
      }
    }

    if (which === "billTo") {
      setBillToTypeByOrder((prev) => ({
        ...prev,
        [orderIndex]: value,
      }));

      if (value === "CUSTOM") {
        setBillToAddressByOrder((prev) => ({
          ...prev,
          [orderIndex]: {
            addressLine1: so.shipping_address_line1 || so.shipping_address || "",
            addressLine2: so.shipping_address_line2 || "",
            city: so.shipping_city || "",
            state: so.shipping_state || "",
            postalCode: so.shipping_postalCode || "",
            country: so.shipping_country || "",
          },
        }));
      }
    }
  };

  const handleShippingFieldChange = (orderIndex, field, value) => {
    setShipToAddressByOrder((prev) => {
      const current = prev[orderIndex] || {};
      return {
        ...prev,
        [orderIndex]: {
          ...current,
          [field]: value,
        },
      };
    });
  };

  const handleBillToFieldChange = (orderIndex, field, value) => {
    setBillToAddressByOrder((prev) => {
      const current = prev[orderIndex] || {};
      return {
        ...prev,
        [orderIndex]: {
          ...current,
          [field]: value,
        },
      };
    });
  };

  const fetchLotsForOrder = async (oIdx, salesOrderId) => {
    if (!companyName || !salesOrderId) {
      setLotsError(prev => ({
        ...prev,
        [oIdx]: "Missing company name or sales order ID for lot allocation.",
      }));
      return;
    }

    try {
      setLotsLoading(prev => ({ ...prev, [oIdx]: true }));
      setLotsError(prev => ({ ...prev, [oIdx]: "" }));

      const res = await fetch(`${API_BASE}/api/allocate_sales_order_lots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: companyName,
          sales_order_id: salesOrderId,
        }),
      });

      const data = await res.json().catch(() => ({}));
      console.log("allocate_sales_order_lots raw response:", data);

      // Check API status
      if (!res.ok || data?.status !== "success") {
        const msg =
          data?.message ||
          data?.detail ||
          "Failed to retrieve the allocate lots for the item";
        setLotsError(prev => ({ ...prev, [oIdx]: msg }));
        return;
      }

      // Backend: selected_lots = [
      //   {
      //     Item_No, Line_No, Location_Code,
      //     Requested_Qty, Unfulfilled_Qty,
      //     Selected_Lots: [ { Lot_No, PO, Posting_Date, Selected_Qty }, ... ]
      //   },
      //   ...
      // ]
      const allocationResults = Array.isArray(data.selected_lots)
        ? data.selected_lots
        : [];

      // Build *grouped-by-item* structure
      const structured = allocationResults.map(item => ({
        itemNo: item.Item_No,
        lineNo: item.Line_No,
        locationCode: item.Location_Code,
        requestedQty: item.Requested_Qty,
        unfulfilledQty: item.Unfulfilled_Qty,
        lots: Array.isArray(item.Selected_Lots)
          ? item.Selected_Lots.map(lot => ({
            lotNo: lot.Lot_No,
            po: lot.PO,
            postingDate: lot.Posting_Date,
            selectedQty: lot.Selected_Qty,
          }))
          : [],
      }));

      setLotsByOrder(prev => ({ ...prev, [oIdx]: structured }));
    } catch (e) {
      setLotsError(prev => ({
        ...prev,
        [oIdx]: String(e?.message || e),
      }));
    } finally {
      setLotsLoading(prev => ({ ...prev, [oIdx]: false }));
    }
  };

  const buildSelectedLotsPayload = (itemAllocations) => {
    if (!Array.isArray(itemAllocations)) return [];

    return itemAllocations.map(item => ({
      Item_No: item.itemNo,
      Line_No: item.lineNo,
      Location_Code: item.locationCode,
      Requested_Qty: item.requestedQty,
      Unfulfilled_Qty: item.unfulfilledQty,
      Selected_Lots: Array.isArray(item.lots)
        ? item.lots.map(lot => ({
          Lot_No: lot.lotNo,
          PO: lot.po,
          Posting_Date: lot.postingDate,
          Selected_Qty: lot.selectedQty,
        }))
        : [],
    }));
  };

  // Compute order totals (subtotal, discount, net total)
  const computeOrderTotals = (orderIndex) => {
    const rows = orderItems?.[orderIndex] || [];
    let subtotal = 0;
    let totalDiscount = 0;
    let netTotal = 0;

    rows.forEach((it, iIdx) => {
      const isCourierLine = !!it?.__courier;

      const so = orders?.[orderIndex];
      const qtyKey = getKey(so, orderIndex, it, iIdx);
      const qtyRaw = qtyMap[qtyKey] ?? it?.quantity ?? 0;
      const qty = toNum(qtyRaw);

      if (!Number.isFinite(qty) || qty <= 0) return;

      const priceInfo = getLinePricing(orderIndex, iIdx);
      const apiPrice = priceInfo.unitPrice;
      const selectedPrice =
        typeof selectedItems?.[orderIndex]?.[iIdx]?.unitPrice === "number"
          ? selectedItems[orderIndex][iIdx].unitPrice
          : 0;

      let unitPrice =
        typeof apiPrice === "number" && apiPrice > 0 ? apiPrice : selectedPrice;

      // Use courierFee for courier line
      if (isCourierLine) {
        const fee =
          typeof courierFee === "number"
            ? courierFee
            : courierFee == null
              ? 0
              : Number(courierFee);
        if (Number.isFinite(fee)) {
          unitPrice = fee;
        }
      }

      const lineBase = unitPrice * qty;

      const rawDiscountPct = getLineDiscountPercent(orderIndex, iIdx);
      const discountPct = isCourierLine ? 0 : rawDiscountPct;
      const lineDiscount = lineBase * (discountPct / 100);
      const lineNet = lineBase - lineDiscount;

      // accumulate totals
      subtotal += lineBase;
      totalDiscount += lineDiscount;
      netTotal += lineNet;
    });

    return {
      subtotal,
      totalDiscount,
      netTotal,
    };
  };

  // Insert Sales Order Line into the BC
  const insertSO = async (oIdx) => {
    // Ask user for confirmation
    const ok = window.confirm("Are you sure you want to insert this Sales Order into Business Central?");
    if (!ok) {
      return;
    }

    setSubmitMsg((m) => ({ ...m, [oIdx]: "" }));
    const v = validateAndBuildPayload(oIdx);
    if (!v.ok) {
      setSubmitMsg((m) => ({ ...m, [oIdx]: v.message }));
      return;
    }
    try {
      setSubmitting((s) => ({ ...s, [oIdx]: true }));
      const res = await fetch(
        `${API_BASE}/api/insert_so_into_bc`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(v.payload),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data?.status === 'success' || data?.status === 'ok')) {
        // Get the Sales Order ID and number from backend response
        const salesOrderId = data?.sales_order_id || null;
        const salesOrderNo = data?.sales_order_no || null;

        setSubmitMsg((m) => ({ ...m, [oIdx]: `Sales Order created successfully (No: ${salesOrderNo}, ID: ${salesOrderId}).` }));

        // Mark this SO as already inserted
        setSoInserted((prev) => ({ ...prev, [oIdx]: true }));

        // Allocate lots for the order after sucessful insert the SO into the BC
        if (salesOrderId) {
          await fetchLotsForOrder(oIdx, salesOrderId);
        }
        else {
          setLotsError(prev => ({
            ...prev,
            [oIdx]:
              "Sales order inserted, but ID not returned from API. Cannot allocate lots automatically.",
          }));
        }

        // Store SO No (for insert_lots_into_sales_order)
        if (salesOrderNo) {
          setSalesOrderNoByIndex(prev => ({ ...prev, [oIdx]: salesOrderNo }))
        }

      } else {
        const msg = data?.message || data?.details || 'Insert SO failed.';
        setSubmitMsg((m) => ({ ...m, [oIdx]: msg }));
      }
    } catch (e) {
      setSubmitMsg((m) => ({ ...m, [oIdx]: String(e?.message || e) }));
    } finally {
      setSubmitting((s) => ({ ...s, [oIdx]: false }));
    }
  };

  // Insert Lots into the specific Sales Order
  const insertLotsIntoSO = async (oIdx) => {
    const itemAllocations = lotsByOrder[oIdx];
    const salesOrderNo = salesOrderNoByIndex[oIdx];

    if (!companyName) {
      setInsertLotsMsg(prev => ({
        ...prev,
        [oIdx]: "Please select a company name.",
      }));
      return;
    }

    if (!salesOrderNo) {
      setInsertLotsMsg(prev => ({
        ...prev,
        [oIdx]: "Missing Sales Order No. Please insert SO first.",
      }));
      return;
    }

    if (!Array.isArray(itemAllocations) || itemAllocations.length === 0) {
      setInsertLotsMsg(prev => ({
        ...prev,
        [oIdx]: "No allocated lots to insert.",
      }));
      return;
    }

    const ok = window.confirm(
      `Insert allocated lots into Sales Order ${salesOrderNo}?`
    );
    if (!ok) return;

    try {
      setInsertLotsSubmitting(prev => ({ ...prev, [oIdx]: true }));
      setInsertLotsMsg(prev => ({ ...prev, [oIdx]: "" }));

      const selectedLotsPayload = buildSelectedLotsPayload(itemAllocations);

      const res = await fetch(
        `${API_BASE}/api/insert_lots_into_sales_order`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            company_name: companyName,
            selected_lots: selectedLotsPayload,
            sales_order_no: salesOrderNo,
          }),
        }
      );

      const data = await res.json().catch(() => ({}));

      if (res.ok && data?.status === "success") {
        setInsertLotsMsg(prev => ({
          ...prev,
          [oIdx]: "Lots successfully inserted into Sales Order.",
        }));
        setLotsInserted(prev => ({ ...prev, [oIdx]: true }));
      } else {
        const msg =
          data?.message ||
          data?.detail ||
          "Failed to insert lots into Sales Order.";
        setInsertLotsMsg(prev => ({ ...prev, [oIdx]: msg }));
      }
    } catch (e) {
      setInsertLotsMsg(prev => ({
        ...prev,
        [oIdx]: String(e?.message || e),
      }));
    } finally {
      setInsertLotsSubmitting(prev => ({ ...prev, [oIdx]: false }));
    }
  };

  const buildShipToAddressPayload = (oIdx) => {
    const so = orders?.[oIdx] || {};
    const customer = selectedCustomers?.[oIdx] || {};
    const shipToType = shipToTypeByOrder[oIdx] || "DEFAULT";

    if (shipToType === "DEFAULT") {
      // use registered customer address
      return {
        mode: "DEFAULT",
        addressLine1: customer.addressLine1 || "",
        addressLine2: customer.addressLine2 || "",
        city: customer.city || "",
        state: customer.state || "",
        postalCode: customer.postalCode || "",
        country: customer.country || "",
      };
    }

    // CUSTOM – use the editable state (already pre-filled from SO)
    const custom = shipToAddressByOrder[oIdx] || {
      addressLine1: so.shipping_address_line1 || so.shipping_address || "",
      addressLine2: so.shipping_address_line2 || "",
      city: so.shipping_city || "",
      state: so.shipping_state || "",
      postalCode: so.shipping_postalCode || "",
      country: so.shipping_country || "",
    };

    return {
      mode: "CUSTOM",
      addressLine1: custom.addressLine1 || "",
      addressLine2: custom.addressLine2 || "",
      city: custom.city || "",
      state: custom.state || "",
      postalCode: custom.postalCode || "",
      country: custom.country || "",
    };
  };

  // Validate the UI field before insert into SO
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
      
      // Qty
      const rawQty = row?.quantity;
      const qty = typeof rawQty === 'number' ? rawQty : Number(rawQty);
      if (!Number.isFinite(qty) || qty <= 0) {
        return { ok: false, message: `Row ${iIdx + 1}: quantity must be > 0.` };
      }

      // Line Discount %
      const discountPct = getLineDiscountPercent(oIdx, iIdx);

      sales_order_lines.push({ lineObjectNumber: chosen.number, quantity: qty, line_discount_percent: discountPct });
    }

    if (sales_order_lines.length === 0) {
      return { ok: false, message: "Add at least one valid item line." };
    }

    const ship_to_address = buildShipToAddressPayload(oIdx);

    return {
      ok: true,
      payload: {
        company_name: companyName || "",
        customer_id: customer.number,
        customer_name: so.customer_name,
        external_doc_no: externalDocs?.[oIdx] || "",
        sales_order_lines,
        comments: comments?.[oIdx] || "",
        shipping_method_id: shipmentMethodIdByOrder[oIdx] || null,
        shipping_agent_code: shipmentAgentCodeByOrder[oIdx] || null,
        ship_to_address: ship_to_address
      },
    };
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
                <div className="mt-3 md:flex md:gap-6 items-stretch">
                  {/* Left: Image */}
                  <div className="md:w-[30rem] md:flex-shrink-0 flex flex-col h-full">
                    <div className="flex-1 flex items-center justify-center h-full">
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
                          <div
                            className="group inline-block w-full h-full overflow-hidden rounded border border-gray-200 bg-white flex items-center justify-center"
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
                        ) : null;
                      })()}
                    </div>
                  </div>

                  {/* Right: Details (customer, items, notes) */}
                  {/* Customer, ship-to and PO */}
                  <div className="md:w-[28rem] flex-1 space-y-6 flex flex-col h-full">
                    <div className="md:col-span-1 rounded-lg shadow-sm">
                      {/* Header Section */}
                      <div className="bg-yellow-100 px-4 py-2 rounded-t-lg flex items-center">
                        <h4 className="text-yellow-900 font-bold text-sm">👤 Customer Information</h4>
                      </div>

                      {/* Main Content: Customer Name, External Doc, and Details */}
                      <div className="p-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6">

                          {/* COLUMN 1: Customer Name (Dropdown + Search Input) */}
                          <div>
                            <p className={UI.label}>Customer Name</p>

                            {/* Container for the Dropdown and the Search Input/Button Group */}
                            <div className="flex flex-col gap-2">

                              {/* 1. Customer Selection Dropdown (Primary) */}
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
                                  <div>
                                    <select
                                      value={valueNumber}
                                      onChange={handleSelect}
                                      className="h-9 w-full rounded border border-gray-300 bg-white px-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-blue-500"
                                    >
                                      {/* Display the name extracted by AI if no match is selected */}
                                      <option value="">{so?.customer_name || "- Select Match -"}</option>
                                      {options.map((c) => (
                                        <option key={(c.number || c.displayName)} value={c.number || ""}>
                                          {(c.displayName || c.number) + (c.number ? ` (${c.number})` : "")}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                );
                              })()}

                              {/* 2. Manual Search Input and Button (Streamlined into a single row) */}
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
                                  className="h-9 w-full rounded border border-gray-300 px-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-blue-500"
                                />
                                <button
                                  type="button"
                                  onClick={() => !isSOReadOnly(idx) && onSearchCustomer?.(idx, typedNames[idx] || so?.customer_name || "")}
                                  className={`h-9 w-9 flex items-center justify-center rounded 
                                    ${isSOReadOnly(idx)
                                      ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                                      : "bg-gray-500 text-white hover:bg-gray-600 cursor-pointer"
                                    }`}
                                  title="Search Customer"
                                >
                                  {/* SVG for Magnifying Glass Icon (Heroicons) */}
                                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                                    <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.449 4.288l3.484 3.484a.75.75 0 11-1.06 1.06l-3.484-3.484A7 7 0 012 9z" clipRule="evenodd" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* COLUMN 2: External Doc No. */}
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
                                onExternalDocChange?.(idx, v);
                              }}
                              placeholder="-"
                              className="h-9 w-full rounded border border-gray-300 px-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-blue-500"
                            />
                          </div>

                          {/* Customer Contact & Registered Address (Full Width Section) */}
                          {selectedCustomers?.[idx] ? (
                            <div className="sm:col-span-2 pt-4 border-t border-gray-200">
                              <p className={`${UI.label} text-lg font-semibold mb-3`}>Customer Details</p>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 text-sm text-gray-900">

                                {/* Contact Information (Left Column) */}
                                <div>
                                  <h4 className="text-gray-700 font-medium mb-2">Contact Information</h4>
                                  <div className="grid grid-cols-[120px_1fr] gap-y-2">

                                    <div className="text-gray-600">Customer No.</div>
                                    <div className="text-gray-900 font-medium">{selectedCustomers[idx]?.number || "-"}</div>

                                    <div className="text-gray-600">Email</div>
                                    <div className="text-gray-900">
                                      {selectedCustomers[idx]?.email ? (
                                        <a href={`mailto:${selectedCustomers[idx].email}`} className="text-blue-600 hover:text-blue-700 transition duration-150 underline">
                                          {selectedCustomers[idx].email}
                                        </a>
                                      ) : "-"}
                                    </div>

                                    <div className="text-gray-600">Phone</div>
                                    <div className="text-gray-900">
                                      {selectedCustomers[idx]?.phoneNumber ? (
                                        <a href={`tel:${selectedCustomers[idx].phoneNumber}`} className="text-blue-600 hover:text-blue-700 transition duration-150 underline">
                                          {selectedCustomers[idx].phoneNumber}
                                        </a>
                                      ) : "-"}
                                    </div>
                                  </div>
                                </div>

                                {/* Registered Address (Right Column) */}
                                <div>
                                  <h4 className="text-gray-700 font-medium mb-2">Registered Address</h4>
                                  <div className="text-gray-900 space-y-0.5">
                                    <p>{selectedCustomers[idx]?.addressLine1 || "-"} {selectedCustomers[idx]?.addressLine2}</p>
                                    <p>
                                      {[selectedCustomers[idx]?.postalCode, selectedCustomers[idx]?.city, selectedCustomers[idx]?.state]
                                        .filter(Boolean)
                                        .join(" ")}
                                      {selectedCustomers[idx]?.country ? `, ${selectedCustomers[idx].country}` : ""}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {/* Shipping Details */}
                    <div className="md:col-span-1 rounded-lg border border-gray-200 bg-white shadow-sm">
                      <div className="bg-green-100 px-4 py-2 rounded-t-lg">
                        <h4 className="text-green-900 font-semibold text-sm">🚚 Shipping Details</h4>
                      </div>

                      <div className="p-4 space-y-6">

                        {/* Shipping Method (Horizontal Layout) */}
                        <div className="space-y-2">
                          <p className={UI.label}>Shipping Method</p>
                          <div className="grid grid-cols-2 gap-4 text-sm">

                            {/* Method dropdown */}
                            <div>
                              <div className="text-gray-500 text-xs mb-1">Method</div>
                              <select
                                value={shipmentMethodIdByOrder[idx] || ""}
                                onChange={(e) =>
                                  setShipmentMethodIdByOrder((prev) => ({
                                    ...prev,
                                    [idx]: e.target.value,
                                  }))
                                }
                                disabled={isSOReadOnly(idx)}
                                className="h-9 w-full rounded border border-gray-300 bg-white px-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-blue-500"
                              >
                                <option value="">
                                  {shipmentMethods.length === 0 ? "- No methods loaded -" : "- Select Method -"}
                                </option>
                                {shipmentMethods.map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.code} - {m.displayName}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* Agent dropdown */}
                            <div>
                              <div className="text-gray-500 text-xs mb-1">Agent</div>
                              <select
                                value={shipmentAgentCodeByOrder[idx] || ""}
                                onChange={(e) =>
                                  setShipmentAgentCodeByOrder((prev) => ({
                                    ...prev,
                                    [idx]: e.target.value, // tie to THIS order only
                                  }))
                                }
                                disabled={isSOReadOnly(idx)}
                                className="h-9 w-full rounded border border-gray-300 bg-white px-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-blue-500"
                              >
                                <option value="">
                                  {shipmentAgents.length === 0 ? "- No agents loaded -" : "- Select Agent -"}
                                </option>
                                {shipmentAgents.map((a) => (
                                  <option key={a.Code} value={a.Code}>
                                    {a.Code} - {a.Name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>

                        <hr className="my-4 border-gray-200" />

                        {/* ## Address Sections (Two-Column Layout) */}
                        <div className="grid md:grid-cols-2 gap-6">

                          {/* COLUMN 1: SHIP TO ADDRESS */}
                          <div className="space-y-3">
                            <p className={UI.label}>📍 Ship To Address</p>

                            {/* Dropdown for Default/Custom Selection (Ship To) */}
                            <div>
                              <div className="text-gray-500 text-xs mb-1">Select Address Type</div>
                              <select
                                value={shipToTypeByOrder[idx] || "DEFAULT"}
                                onChange={(e) =>
                                  handleShippingTypeChange(idx, "shipTo", e.target.value)
                                }
                                className="h-9 w-full rounded border border-gray-300 bg-white px-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-blue-500"
                              >
                                <option value="DEFAULT">Default (Customer Registered Address)</option>
                                <option value="CUSTOM">Custom Address</option>
                              </select>
                            </div>

                            {/* SHIP TO: CONDITIONAL DISPLAY/INPUTS */}
                            {(() => {
                              const customer = selectedCustomers[idx];
                              const so = orders?.[idx] || {};
                              const shipToType = shipToTypeByOrder[idx] || "DEFAULT";
                              const inputClass = "rounded border border-gray-300 px-2 h-8 text-gray-900 text-sm focus:border-blue-500 focus:ring-blue-500 w-full";
                              const labelClass = "text-gray-500 text-xs mb-1";

                              if (shipToType === "DEFAULT") {
                                return (
                                  <div className="p-3 bg-gray-50 rounded-md border border-gray-200 mt-2">
                                    <div className="grid grid-cols-[80px_1fr] gap-y-1 text-sm">
                                      <div className="text-gray-500 font-medium">Line 1:</div>
                                      <div className="text-gray-900">{customer?.addressLine1 || "-"}</div>

                                      <div className="text-gray-500 font-medium">Line 2:</div>
                                      <div className="text-gray-900">{customer?.addressLine2 || "-"}</div>

                                      <div className="text-gray-500 font-medium">City, State:</div>
                                      <div className="text-gray-900">
                                        {customer?.city || "-"}, {customer?.state || "-"}
                                      </div>

                                      <div className="text-gray-500 font-medium">Postal, Ctry:</div>
                                      <div className="text-gray-900">
                                        {customer?.postalCode || "-"}, {customer?.country || "-"}
                                      </div>
                                    </div>
                                  </div>
                                );
                              }

                              // CUSTOM: EDITABLE INPUTS (Ship To)
                              const custom = shipToAddressByOrder[idx] || {
                                addressLine1: so.shipping_address_line1 || so.shipping_address || "",
                                addressLine2: so.shipping_address_line2 || "",
                                city: so.shipping_city || "",
                                state: so.shipping_state || "",
                                postalCode: so.shipping_postalCode || "",
                                country: so.shipping_country || "",
                              };

                              return (
                                <div className="space-y-2 pt-2">
                                  <div>
                                    <div className={labelClass}>Address Line 1</div>
                                    <input
                                      type="text"
                                      value={custom.addressLine1}
                                      onChange={(e) =>
                                        handleShippingFieldChange(idx, "addressLine1", e.target.value)
                                      }
                                      className={inputClass}
                                    />
                                  </div>

                                  <div>
                                    <div className={labelClass}>Address Line 2</div>
                                    <input
                                      type="text"
                                      value={custom.addressLine2}
                                      onChange={(e) =>
                                        handleShippingFieldChange(idx, "addressLine2", e.target.value)
                                      }
                                      className={inputClass}
                                    />
                                  </div>

                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <div className={labelClass}>City</div>
                                      <input
                                        type="text"
                                        value={custom.city}
                                        onChange={(e) =>
                                          handleShippingFieldChange(idx, "city", e.target.value)
                                        }
                                        className={inputClass}
                                      />
                                    </div>
                                    <div>
                                      <div className={labelClass}>State</div>
                                      <input
                                        type="text"
                                        value={custom.state}
                                        onChange={(e) =>
                                          handleShippingFieldChange(idx, "state", e.target.value)
                                        }
                                        className={inputClass}
                                      />
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <div className={labelClass}>Postal Code</div>
                                      <input
                                        type="text"
                                        value={custom.postalCode}
                                        onChange={(e) =>
                                          handleShippingFieldChange(idx, "postalCode", e.target.value)
                                        }
                                        className={inputClass}
                                      />
                                    </div>
                                    <div>
                                      <div className={labelClass}>Country</div>
                                      <input
                                        type="text"
                                        value={custom.country}
                                        onChange={(e) =>
                                          handleShippingFieldChange(idx, "country", e.target.value)
                                        }
                                        className={inputClass}
                                      />
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>

                          {/* COLUMN 2: BILL TO ADDRESS */}
                          <div className="space-y-3">
                            <p className={UI.label}>💳 Bill To Address</p>

                            {/* Always Default — Read-Only */}
                            <div className="p-3 bg-gray-50 rounded-md border border-gray-200 mt-19.5">
                              <div className="grid grid-cols-[80px_1fr] gap-y-1 text-sm">
                                <div className="text-gray-500 font-medium">Line 1:</div>
                                <div className="text-gray-900">
                                  {selectedCustomers[idx]?.addressLine1 || "-"}
                                </div>

                                <div className="text-gray-500 font-medium">Line 2:</div>
                                <div className="text-gray-900">
                                  {selectedCustomers[idx]?.addressLine2 || "-"}
                                </div>

                                <div className="text-gray-500 font-medium">City, State:</div>
                                <div className="text-gray-900">
                                  {selectedCustomers[idx]?.city || "-"},{" "}
                                  {selectedCustomers[idx]?.state || "-"}
                                </div>

                                <div className="text-gray-500 font-medium">Postal, Ctry:</div>
                                <div className="text-gray-900">
                                  {selectedCustomers[idx]?.postalCode || "-"},{" "}
                                  {selectedCustomers[idx]?.country || "-"}
                                </div>
                              </div>
                            </div>
                          </div>

                        </div>
                      </div>
                    </div>

                    {/* Items (with inline allocated lots dropdown) */}
                    <div className="mt-3 sm:col-span-2 pt-4 border-t border-gray-200">
                      <p className={UI.label}>📝 Items</p>

                      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
                        {Array.isArray(so?.items) && so.items.length > 0 ? (
                          <table className="min-w-full divide-y divide-gray-200 text-sm">
                            <thead className="bg-blue-100">
                              <tr>
                                <th className="px-3 py-2 text-left font-semibold text-blue-900 w-100">
                                  Item
                                </th>
                                <th className="px-10 py-2 text-left font-semibold text-blue-900 w-5">
                                  Category
                                </th>
                                <th className="px-3 py-2 text-left font-semibold text-blue-900 w-25">
                                  Unit Price
                                </th>
                                <th className="px-3 py-2 text-left font-semibold text-blue-900 w-20">
                                  UOM
                                </th>
                                <th className="px-20 py-2 text-left font-semibold text-blue-900 w-20">
                                  Qty (m)
                                </th>
                                <th className="px-3 py-2 text-left font-semibold text-blue-900 w-10">
                                  Line Disc (%)
                                </th>
                                <th className="px-3 py-2 text-left font-semibold text-blue-900 w-10">
                                  Line Amt
                                </th>
                                <th className="px-23 py-2 text-left font-semibold text-blue-900 w-50">
                                  Lots
                                </th>
                              </tr>
                            </thead>

                            <tbody className="divide-y divide-gray-100">
                              {(orderItems?.[idx] || []).map((it, iidx) => {
                                const qKey = getKey(so, idx, it, iidx);
                                const qty = qtyMap[qKey] ?? (it?.quantity ?? 0);
                                const priceInfo = getLinePricing(idx, iidx);
                                const apiUnitPrice = priceInfo.unitPrice;
                                const unitOfMeasureCode = priceInfo.unitOfMeasureCode || selectedItems?.[idx]?.[iidx]?.baseUnitOfMeasureCode || "";

                                const selectedUnitPrice = typeof selectedItems?.[idx]?.[iidx]?.unitPrice === "number" ? selectedItems[idx][iidx].unitPrice : 0;
                                const isCourierLine = !!it.__courier;
                                let effectiveUnitPrice = typeof apiUnitPrice === "number" && apiUnitPrice > 0 ? apiUnitPrice : selectedUnitPrice;

                                // For courier line, override with courierFee
                                if (isCourierLine) {
                                  const fee =
                                    typeof courierFee === "number"
                                      ? courierFee
                                      : courierFee == null
                                        ? 0
                                        : Number(courierFee);
                                  if (Number.isFinite(fee)) {
                                    effectiveUnitPrice = fee;
                                  }
                                }
                                const discountPct = getLineDiscountPercent(idx, iidx);
                                const qtyNum = toNum(qty);
                                const lineBase = effectiveUnitPrice * qtyNum;
                                const lineDiscount = lineBase * (discountPct / 100);
                                const lineNet = lineBase - lineDiscount;

                                const options = itemOptions?.[idx]?.[iidx] || [];
                                const sel = selectedItems?.[idx]?.[iidx] || null;
                                const selValue = sel?.number || "";
                                const key = `${idx}:${iidx}`;
                                const qv = itemQueries[key] ?? "";

                                // ---- find allocation for THIS item ----
                                const allocations = Array.isArray(lotsByOrder[idx])
                                  ? lotsByOrder[idx]
                                  : [];

                                const allocForItem =
                                  allocations.find((a) => {
                                    // prefer matching by lineNo if present
                                    const itemLineNo = it?.lineNo ?? it?.line_no;
                                    if (itemLineNo != null && a.lineNo != null) {
                                      return a.lineNo === itemLineNo;
                                    }
                                    // fallback: match by itemNo
                                    if (sel?.number && a.itemNo) {
                                      return a.itemNo === sel.number;
                                    }
                                    return false;
                                  }) || null;

                                const lotCount = allocForItem?.lots?.length || 0;
                                const rowKey = `${idx}-${iidx}`;
                                const isExpanded = !!expandedLots[rowKey];

                                return (
                                  <React.Fragment key={it?.id ?? iidx}>
                                    {/* MAIN ITEM ROW */}
                                    <tr>
                                      {/* Item: dropdown + search */}
                                      <td className="px-3 py-2 align-top">
                                        <div className="space-y-2">
                                          {/* 1. Dropdown */}
                                          <select
                                            value={selValue}
                                            onChange={(e) => {
                                              const num = e.target.value;
                                              const chosen =
                                                options.find(
                                                  (o) => (o.number || "") === num,
                                                ) || null;
                                              onSelectItem?.(idx, iidx, chosen);
                                            }}
                                            className="h-9 w-full rounded border border-gray-300 bg-white px-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-blue-500"
                                          >
                                            <option value="">
                                              {it?.fabric_name ||
                                                it?.name ||
                                                "- Select Item Match -"}
                                            </option>
                                            {options.map((o) => (
                                              <option
                                                key={o.number || o.displayName}
                                                value={o.number || ""}
                                              >
                                                {(o.displayName || o.number) +
                                                  (o.number ? ` (${o.number})` : "")}
                                              </option>
                                            ))}
                                          </select>

                                          {/* 2. Search input + button */}
                                          <div className="flex items-center gap-2">
                                            <input
                                              type="text"
                                              value={qv}
                                              onChange={(e) =>
                                                setItemQueries((prev) => ({
                                                  ...prev,
                                                  [key]: e.target.value,
                                                }))
                                              }
                                              placeholder="Search item…"
                                              className="h-9 w-full rounded border border-gray-300 px-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-blue-500"
                                            />
                                            <button
                                              type="button"
                                              onClick={() => !isSOReadOnly(idx) && onSearchItem?.(idx, iidx, qv)}
                                              className={`h-9 w-9 flex items-center justify-center rounded 
                                                ${isSOReadOnly(idx)
                                                  ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                                                  : "bg-gray-500 text-white hover:bg-gray-600 cursor-pointer"
                                                }`}
                                              title="Search Item"
                                            >
                                              <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                viewBox="0 0 20 20"
                                                fill="currentColor"
                                                className="w-5 h-5"
                                              >
                                                <path
                                                  fillRule="evenodd"
                                                  d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.449 4.288l3.484 3.484a.75.75 0 11-1.06 1.06l-3.484-3.484A7 7 0 012 9z"
                                                  clipRule="evenodd"
                                                />
                                              </svg>
                                            </button>
                                          </div>
                                        </div>
                                      </td>

                                      {/* Category */}
                                      <td className="px-10 py-2 align-middle text-sm text-gray-900">
                                        {selectedItems?.[idx]?.[iidx]?.itemCategoryCode || "-"}
                                      </td>


                                      {/* Unit price */}
                                      <td className="px-3 py-2 align-middle text-right text-sm text-gray-900 font-medium">
                                        {Number.isFinite(effectiveUnitPrice)
                                          ? effectiveUnitPrice.toFixed(2)
                                          : "-"}
                                      </td>

                                      {/* Unit Measure Code */}
                                      <td className="px-3 py-2 align-middle text-sm text-gray-900">
                                        {isCourierLine ? "-" : unitOfMeasureCode || "-"}
                                      </td>

                                      {/* Quantity */}
                                      <td className="px-3 py-2 align-middle">
                                        <div className="flex items-center justify-end">
                                          <div className="flex rounded-md border border-gray-200">
                                            <button
                                              title="Dec Qty"
                                              disabled={isSOReadOnly(idx)}
                                              onClick={() => !isSOReadOnly(idx) && updateQtyForRow(idx, iidx, toNum(qty) - STEP)}
                                              className={`h-8 w-8 rounded-l 
                                                ${isSOReadOnly(idx)
                                                  ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                                                  : "text-gray-700 hover:bg-gray-50"
                                                }`}
                                            >
                                              -
                                            </button>

                                            <input
                                              type="number"
                                              min={0}
                                              step={STEP}
                                              inputMode="decimal"
                                              value={qty}
                                              onChange={(e) =>
                                                updateQtyForRow(idx, iidx, e.target.value)
                                              }
                                              className="h-8 w-16 text-center text-sm focus:outline-none border-x border-gray-200"
                                            />
                                            <button
                                              title="Inc Qty"
                                              disabled={isSOReadOnly(idx)}
                                              onClick={() => !isSOReadOnly(idx) && updateQtyForRow(idx, iidx, toNum(qty) + STEP)}
                                              className={`h-8 w-8 rounded-r 
                                                ${isSOReadOnly(idx)
                                                  ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                                                  : "text-gray-700 hover:bg-gray-50"
                                                }`}
                                            >
                                              +
                                            </button>
                                          </div>

                                          {/* Delete item */}
                                          <button
                                            type="button"
                                            title="Remove Item"
                                            disabled={isSOReadOnly(idx)}
                                            onClick={() => !isSOReadOnly(idx) && removeItem(idx, iidx)}
                                            className={`ml-2 h-8 w-8 flex items-center justify-center rounded-full 
                                              ${isSOReadOnly(idx)
                                                ? "text-gray-400 bg-gray-100 cursor-not-allowed"
                                                : "text-red-600 hover:bg-red-50 cursor-pointer"
                                              }`}
                                          >

                                            <svg
                                              xmlns="http://www.w3.org/2000/svg"
                                              fill="none"
                                              viewBox="0 0 24 24"
                                              strokeWidth={1.5}
                                              stroke="currentColor"
                                              className="w-4 h-4"
                                            >
                                              <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                d="M6 18L18 6M6 6l12 12"
                                              />
                                            </svg>
                                          </button>
                                        </div>
                                      </td>

                                      {/* Line Discount % */}
                                      <td className="px-3 py-2 align-middle text-right text-sm text-gray-900">
                                        {isCourierLine ? (
                                          <span className="text-xs text-gray-400">N/A</span>
                                        ) : (
                                          <input
                                            type="number"
                                            min={0}
                                            max={100}
                                            step={0.5}
                                            value={discountPct}
                                            onChange={(e) =>
                                              setLineDiscountPercent(idx, iidx, e.target.value)
                                            }
                                            className="h-8 w-20 rounded border border-gray-300 px-2 text-right text-sm text-gray-900 focus:border-blue-500 focus:ring-blue-500"
                                          />
                                        )}
                                      </td>

                                      {/* Line Amount (after discount) */}
                                      <td className="px-3 py-2 align-middle text-right text-sm text-gray-900 font-medium">
                                        {Number.isFinite(lineNet) ? lineNet.toFixed(2) : "-"}
                                      </td>

                                      {/* Lots summary + dropdown toggle */}
                                      <td className="px-17 py-2 align-middle text-left">
                                        {allocForItem ? (
                                          <div className="flex flex-col items-start gap-1">
                                            <div className="flex flex-wrap justify-start gap-1 text-[11px]">
                                              <span className="inline-flex rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-700">
                                                Req: {allocForItem.requestedQty ?? "-"}
                                              </span>
                                              <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                                                Unf: {allocForItem.unfulfilledQty ?? "-"}
                                              </span>
                                            </div>
                                            <button
                                              type="button"
                                              onClick={() => toggleLots(rowKey)}
                                              className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 cursor-pointer"
                                            >
                                              {isExpanded
                                                ? `Hide lots (${lotCount})`
                                                : `View lots (${lotCount})`}
                                              <span
                                                className={`transition-transform ${isExpanded ? "rotate-180" : ""
                                                  }`}
                                              >
                                                ▾
                                              </span>
                                            </button>
                                          </div>
                                        ) : (
                                          <span className="text-xs text-gray-400">
                                            No lots allocated
                                          </span>
                                        )}
                                      </td>
                                    </tr>

                                    {/* DROPDOWN ROW FOR LOTS */}
                                    {isExpanded && allocForItem && (
                                      <tr className="bg-gray-50">
                                        <td colSpan={5} className="px-3 pb-3 pt-0">
                                          <div className="mt-1 rounded-lg border border-gray-200 bg-white">
                                            <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 text-xs">
                                              <div className="font-semibold text-gray-700">
                                                Lots for {allocForItem.itemNo ?? "-"} (Line{" "}
                                                {allocForItem.lineNo ?? "-"})
                                              </div>
                                              <div className="text-[11px] text-gray-500">
                                                Location: {allocForItem.locationCode ?? "-"}
                                              </div>
                                            </div>

                                            <div className="overflow-x-auto">
                                              <table className="min-w-full divide-y divide-gray-200 text-[11px]">
                                                <thead className="bg-gray-50">
                                                  <tr>
                                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">
                                                      Lot No
                                                    </th>
                                                    <th className="px-3 py-2 text-right font-semibold text-gray-700">
                                                      Selected Qty
                                                    </th>
                                                  </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100">
                                                  {allocForItem.lots.map((lot, lidx) => (
                                                    <tr key={`${lot.lotNo}-${lidx}`}>
                                                      <td className="px-3 py-2 text-gray-900">
                                                        {lot.lotNo ?? "-"}
                                                      </td>
                                                      <td className="px-3 py-2 text-right text-gray-900">
                                                        {lot.selectedQty ?? "-"}
                                                      </td>
                                                    </tr>
                                                  ))}
                                                </tbody>
                                              </table>
                                            </div>
                                          </div>
                                        </td>
                                      </tr>
                                    )}
                                  </React.Fragment>
                                );
                              })}
                            </tbody>
                          </table>
                        ) : (
                          <div className="px-3 py-2 text-sm text-gray-500">
                            No items detected. Please review the screenshot or add items manually.
                          </div>
                        )}

                        {/* Add Item Button */}
                        <div className="px-3 py-2 flex justify-end">
                          <button
                            type="button"
                            disabled={isSOReadOnly(idx)}
                            onClick={() => !isSOReadOnly(idx) && addItem(idx)}
                            className={`inline-flex items-center px-3 py-2 text-xs rounded-md 
                                ${isSOReadOnly(idx)
                                ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                                : "text-gray-700 border border-gray-300 hover:bg-gray-50 cursor-pointer"
                              }`}
                          >
                            + Add Item
                          </button>
                        </div>
                      </div>

                      {/* Courier Fee Warning */}
                      {(() => {
                        const rows = orderItems?.[idx] || [];
                        let total = 0;
                        rows.forEach((rit, rIdx) => {
                          const k = getKey(so, idx, rit, rIdx);
                          const raw = qtyMap[k] ?? rit?.quantity ?? 0;
                          const n =
                            typeof raw === "number" ? raw : parseFloat(String(raw || "0"));
                          total += Number.isFinite(n) ? n : 0;
                        });

                        if (courierFee != null && total <= 2) {
                          const feeText =
                            typeof courierFee === "number"
                              ? courierFee.toFixed(2)
                              : String(courierFee);
                          return (
                            <div className="px-3 pb-2 pt-2 flex justify-end">
                              <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 flex items-center gap-2">
                                Courier Fee applies (≤ 2 m): {feeText}
                              </div>
                            </div>
                          );
                        }
                        return null;
                      })()}

                      {/* Compute total order */}
                      {(() => {
                        const { subtotal, totalDiscount, netTotal } = computeOrderTotals(idx);
                        if (subtotal === 0 && netTotal === 0) return null;

                        return (
                          <div className="px-3 pb-3 pt-2 flex justify-end">
                            <div className="text-sm text-gray-800 space-y-1 text-right">
                              <div>
                                <span className="font-medium">Subtotal (Before Discount): RM</span>
                                <span>{subtotal.toFixed(2)}</span>
                              </div>
                              <div>
                                <span className="font-medium">Total Discount Amount: RM</span>
                                <span className="text-amber-700">- {totalDiscount.toFixed(2)}</span>
                              </div>
                              <div>
                                <span className="font-semibold">Final Total (After Discount): RM</span>
                                <span className="font-semibold text-green-700">
                                  {netTotal.toFixed(2)}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Comments */}
                    <div className="mt-3">
                      <p className={UI.label}>💬 Sales Order Comments/Remarks</p>
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

                    {/* Notes */}
                    {so?.notes ? (
                      <div className="mt-3">
                        <p className={UI.label}>✍️ AI-Generated Notes</p>
                        <div className="whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 shadow-sm">
                          {so.notes}
                        </div>
                      </div>
                    ) : null}

                    {/* Insert SO Action */}
                    <div className="mt-4 flex items-center justify-between">
                      <div className="text-sm text-red-600">{submitMsg[idx] || ''}</div>
                      <button
                        onClick={() => insertSO(idx)}
                        disabled={submitting[idx] || soInserted[idx]}
                        className={`px-5 py-2 text-xs rounded-md ${soInserted[idx]
                          ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                          : submitting[idx]
                            ? "bg-gray-400 text-white cursor-wait"
                            : "text-gray-700 border border-gray-300 hover:bg-gray-50 cursor-pointer"
                          }`}
                      >
                        {soInserted[idx]
                          ? "Inserted"
                          : submitting[idx]
                            ? "Inserting..."
                            : "Insert SO"}
                      </button>
                    </div>

                    {/* Insert lots into SO action */}
                    <div className="mt-3 flex items-center justify-between">
                      <div className="text-xs text-gray-600">
                        {insertLotsMsg[idx] && <span>{insertLotsMsg[idx]}</span>}
                      </div>
                      <button
                        onClick={() => insertLotsIntoSO(idx)}
                        disabled={
                          insertLotsSubmitting[idx] ||
                          lotsInserted[idx] ||
                          !lotsByOrder[idx] ||
                          (Array.isArray(lotsByOrder[idx]) && lotsByOrder[idx].length === 0)
                        }
                        className={`px-3 py-2 text-xs rounded-md ${lotsInserted[idx]
                          ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                          : insertLotsSubmitting[idx]
                            ? "bg-gray-400 text-white cursor-wait"
                            : "text-gray-700 border border-gray-300 hover:bg-gray-50 cursor-pointer"
                          }`}
                      >
                        {lotsInserted[idx]
                          ? "Lots Inserted"
                          : insertLotsSubmitting[idx]
                            ? "Inserting Lots..."
                            : "Commit/Save Lots"}
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
                className="absolute top-4 right-4 rounded bg-white/90 px-3 py-1 text-sm font-medium shadow hover:bg-white cursor-pointer"
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






