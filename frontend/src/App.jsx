import React, { useCallback, useState } from 'react';
import Sidebar from '/components/Sidebar.jsx';
import ChatBox from '../components/ChatBox';

const API_BASE = import.meta?.env?.VITE_API_BASE_URL || 'http://localhost:8000';

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [orders, setOrders] = useState([]);
  const [images, setImages] = useState([]);
  const [lastForm, setLastForm] = useState(null);
  const [customerOptions, setCustomerOptions] = useState([]);
  const [selectedCustomers, setSelectedCustomers] = useState([]); 
  const [itemOptions, setItemOptions] = useState([]);
  const [selectedItems, setSelectedItems] = useState([]); //2D: [orderIdx][itemIdx] = list[]
  const [courierFee, setCourierFee] = useState(null); // fetched once

  // Fetch courier details once per selected company (endpoint requires company_name)
  React.useEffect(() => {
    const company = lastForm?.companyName;
    if (!company) return;
    let cancelled = false;
    (async () => {
      try {
        const cn = encodeURIComponent(company);
        const res = await fetch(`${API_BASE}/api/get_courier_details?company_name=${cn}`);
        const data = await res.json();
        if (cancelled) return;
        // Endpoint returns { number, displayName, itemCategoryCode, unitPrice }
        const fee = typeof data?.unitPrice === 'number' ? data.unitPrice : null;
        setCourierFee(fee);
      } catch (_) {
        // ignore; fee stays null
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lastForm?.companyName]);


  const handleSearch = useCallback(async (form) => {
    setLoading(true);
    setError(null);
    setOrders([]);

    try{
      // Fetch sales order details using folder path
      const salesOrderUrl = `${API_BASE}/api/get_sales_order_details?folder_path=${encodeURIComponent(form.folderPath)}`;
      const salesOrderRes = await fetch(salesOrderUrl);
      const salesOrderData = await salesOrderRes.json();
      setOrders(Array.isArray(salesOrderData?.sales_orders_items) ? salesOrderData.sales_orders_items : []);
      setImages(Array.isArray(salesOrderData?.sales_orders_images_b64) ? salesOrderData.sales_orders_images_b64 : []);

      // Keep last form to know company for subsequent API calls
      setLastForm(form);

      // -- Fetch customer suggestions for each parsed order customer name --
      const items = Array.isArray(salesOrderData?.sales_orders_items) ? salesOrderData.sales_orders_items : [];
      if (items.length && form?.companyName) {
        const opts = await Promise.all(
          items.map(async (so) => {
            const q = encodeURIComponent(so?.customer_name || "");
            const cn = encodeURIComponent(form.companyName || "");
            const url = `${API_BASE}/api/get_customer_details?company_name=${cn}&customer_name_query=${q}`;
            try {
              const res = await fetch(url);
              const data = await res.json();
              const list =
                (Array.isArray(data?.customer_search_results) && data.customer_search_results) ||
                (Array.isArray(data?.customer_names?.results) && data.customer_names.results) ||
                (Array.isArray(data?.customer_names) && data.customer_names) ||
                [];
              return list;
            } catch {
              return [];
            }
          })
        );
        setCustomerOptions(opts);
        // Auto-select: exact match if available; otherwise first suggestion
        setSelectedCustomers(
          opts.map((list, i) => {
            const parsed = (items[i]?.customer_name || "").toLowerCase().trim();
            const exact = (list || []).find((c) => (c.displayName || "").toLowerCase().trim() === parsed);
            return exact || (Array.isArray(list) && list.length > 0 ? list[0] : null);
          })
        );

      // -- Fetch product item suggestions from Business Central --
      const allOrdersItemOptions = await Promise.all(
        items.map(async (order) => {
          const lists = await Promise.all(
            (order.items || []).map(async (it) => {
              const item_name = encodeURIComponent(it?.fabric_name || it?.name || "");
              const item_category_name = encodeURIComponent(form.category || "");
              const company_name = encodeURIComponent(form.companyName || "");

              if (!item_name) return [];
              try {
                const url = `${API_BASE}/api/get_item_details?company_name=${company_name}&item_name_query=${item_name}&item_category=${item_category_name}`;
                const res = await fetch(url);
                const data = await res.json();
                return (
                  (Array.isArray(data?.item_search_results) && data.item_search_results) ||
                  (Array.isArray(data?.items) && data.items) ||
                  []
                );
              } catch {
                return [];
              }
            })
          );
          return lists;
        })
      );
      setItemOptions(allOrdersItemOptions);
      // Auto-select per order row: try to match parsed name, else first suggestion
      const autoSelect = allOrdersItemOptions.map((listsForOrder, oIdx) => {
        const order = items[oIdx] || {};
        return (listsForOrder || []).map((list, iIdx) => {
          const parsed = ((order.items?.[iIdx]?.fabric_name || order.items?.[iIdx]?.name || "") + "")
            .toLowerCase()
            .trim();
          const exact = (list || []).find(
            (x) =>
              (x.displayName || "").toLowerCase().includes(parsed) ||
              (x.number || "").toLowerCase() === parsed
          );
          return exact || (Array.isArray(list) && list[0]) || null;
        });
      });
      setSelectedItems(autoSelect);

      } else {
        setCustomerOptions([]);
        setSelectedCustomers([]);
      }
    }catch(err){
      setError(err.message);
    }finally{
      setLoading(false);
    }
  }, []);

  // Allow ChatBox to request a new search for a specific order index
  const handleSearchCustomerForOrder = useCallback(async (orderIndex, query) => {
    if (!lastForm?.companyName) return;
    try {
      const company_name = encodeURIComponent(lastForm.companyName);
      const customer_name_query = encodeURIComponent(query || "");
      const url = `${API_BASE}/api/get_customer_details?company_name=${company_name}&customer_name_query=${customer_name_query}`;
      const res = await fetch(url);
      const data = await res.json();
      const list =
        (Array.isArray(data?.customer_search_results) && data.customer_search_results) ||
        (Array.isArray(data?.customer_names?.results) && data.customer_names.results) ||
        (Array.isArray(data?.customer_names) && data.customer_names) ||
        [];
      setCustomerOptions((prev) => {
        const next = prev.slice();
        next[orderIndex] = list;
        return next;
      });
      setSelectedCustomers((prev) => {
        const next = prev.slice();
        const current = next[orderIndex];
        if (list.length === 1) {
          next[orderIndex] = list[0];
        } else if (!current && list.length > 0) {
          // If nothing selected yet, pick the first suggestion to show details
          next[orderIndex] = list[0];
        }
        return next;
      });
    } catch (e) {
      console.error("Customer search failed", e);
    }
  }, [lastForm]);

  const handleSelectCustomer = useCallback((orderIndex, customer) => {
    setSelectedCustomers((prev) => {
      const next = prev.slice();
      next[orderIndex] = customer || null;
      return next;
    });
  }, []);

  // Per-row item search/select handlers
  const handleSearchItem = useCallback(async (orderIndex, itemIndex, query, category) => {
    if (!lastForm?.companyName) return;
    try {
      const company_name = encodeURIComponent(lastForm.companyName);
      const q = encodeURIComponent(query || "");
      const cat = encodeURIComponent(category ?? lastForm?.category ?? "");
      const url = `${API_BASE}/api/get_item_details?company_name=${company_name}&item_name_query=${q}&item_category=${cat}`;
      const res = await fetch(url);
      const data = await res.json();
      const list =
        (Array.isArray(data?.item_search_results) && data.item_search_results) ||
        (Array.isArray(data?.items) && data.items) ||
        [];
      setItemOptions((prev) => {
        const next = prev.map((row) => (row ? row.slice() : []));
        next[orderIndex] = (next[orderIndex] || []).slice();
        next[orderIndex][itemIndex] = list;
        return next;
      });
      setSelectedItems((prev) => {
        const next = prev.map((row) => (row ? row.slice() : []));
        const current = next[orderIndex]?.[itemIndex];
        if (!current || list.length === 1) {
          next[orderIndex] = (next[orderIndex] || []).slice();
          next[orderIndex][itemIndex] = list[0] || null;
        }
        return next;
      });
    } catch (e) {
      console.error("Item search failed", e);
    }
  }, [lastForm]);

  const handleSelectItem = useCallback((orderIndex, itemIndex, item) => {
    setSelectedItems((prev) => {
      const next = prev.map((row) => (row ? row.slice() : []));
      next[orderIndex] = (next[orderIndex] || []).slice();
      next[orderIndex][itemIndex] = item || null;
      return next;
    });
  }, []);

  return (
    <>
      {/* Header */}
      <div className="w-full bg-gray-100 text-black text-lg px-4 py-3 shadow flex items-center gap-5">
        <button
          onClick={() => setSidebarOpen(prev => !prev)}
          className="focus:outline-none mr-2 hover:bg-gray-200 rounded p-1 transition cursor-pointer"
          aria-label="Toggle sidebar"
        >
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <img src="/jotex-header-logo.png" alt="JoTex Logo" className="h-6 w-24" />
        Sales Order AI Assistant 
      </div>

      {/* Main Layout */}
      <div className="flex h-screen">
        {/* Sidebar */}
        {sidebarOpen && (
          <div className="w-80 border-r border-gray-200 bg-white">
            <Sidebar onSearch={handleSearch} loading={loading} />
          </div>
        )}

        {/* ChatBox Section */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0 bg-gray-50">
          <ChatBox
            orders={orders}
            images={images}
            loading={loading}
            error={error}
            companyName={lastForm?.companyName}
            country={lastForm?.country}
            region={lastForm?.region}
            customerOptions={customerOptions}
            selectedCustomers={selectedCustomers}
            onSearchCustomer={handleSearchCustomerForOrder}
            onSelectCustomer={handleSelectCustomer}
            itemOptions={itemOptions}
            selectedItems={selectedItems}
            onSearchItem={handleSearchItem}
            onSelectItem={handleSelectItem}
            courierFee={courierFee}
          />
        </div>
      </div>
    </>
  );
}

export default App;
