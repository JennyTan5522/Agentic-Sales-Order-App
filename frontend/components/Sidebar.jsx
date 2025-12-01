import React, { useEffect, useState } from "react";
import TextField from "./fields/TextField";
import DateField from "./fields/DateField";
import SelectField from "./fields/SelectField";

// const API_BASE = import.meta?.env?.VITE_API_BASE_URL || 'http://localhost:8000';
const API_BASE = 'http://localhost:8001';
const MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function fetchJson(url) {
  return fetch(url).then(async (res) => {
    const contentType = res.headers.get("content-type") || "";
    if (!res.ok) {
      throw new Error(`Request failed: ${res.status}`);
    }
    if (!contentType.includes("application/json")) {
      const text = await res.text();
      throw new Error(`Expected JSON, got: ${text.slice(0, 100)}`);
    }
    return res.json();
  });
}

export default function Sidebar({ onSearch, loading }) {
  const required = (text) => (
    <>
      {text} <span className="text-red-500">*</span>
    </>
  );
  const today = new Date().toISOString().slice(0, 10);

  const [companies, setCompanies] = useState([]);
  const [countries, setCountries] = useState([]);
  const [regions, setRegions] = useState([]);
  const [onedriveBase, setOnedriveBase] = useState("");

  const [envOptions, setEnvOptions] = useState([]);
  const [bcEnv, setBcEnv] = useState("");

  const [form, setForm] = useState({
    companyName: "",
    date: today,
    folderPath: "",
    category: "FABRICS",
  });

  const COUNTRY_COMPANY_MAP = {
    MY: "Jotex Sdn Bhd",
    SG: "Jotex Pte Ltd",
  };

  const categories = [
    { label: "FABRICS", value: "FABRICS" },
    { label: "SmartHome", value: "SmartHome" },
  ];

  // --- Load BC env options and default selected env from backend ---
  useEffect(() => {
    fetchJson(`${API_BASE}/api/config/bc_env_options`)
      .then((data) => {
        setEnvOptions(
          (data?.options || []).map((env) => ({
            label: env,
            value: env,
          }))
        );
        // default selected env from backend config
        setBcEnv(data?.selected || "");
      })
      .catch((err) => {
        console.error("Failed to load BC Environment options:", err);
      });
  }, []);

  // --- Load OneDrive base path ---
  useEffect(() => {
    fetchJson(`${API_BASE}/api/config/onedrive_dir_path`)
      .then((data) => {
        const base = (data?.onedrive_dir_path || "").trim();
        setOnedriveBase(base);
      })
      .catch((err) => {
        console.error("Failed to load OneDrive base path:", err);
      });
  }, []);

  // --- Fetch company names whenever env changes (backend uses global env) ---
  useEffect(() => {
    if (!bcEnv) return;

    fetchJson(`${API_BASE}/api/company_names`)
      .then((data) => {
        if (Array.isArray(data?.company_names)) {
          setCompanies(
            data.company_names.map((name) => ({ label: name, value: name }))
          );
        }
      })
      .catch((err) => {
        console.error("Failed to load company names:", err);
      });
  }, [bcEnv]);

  // --- Initial countries by year ---
  useEffect(() => {
    fetchCountriesByYear(today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Regions whenever country/date changes ---
  useEffect(() => {
    if (form.country) {
      fetchRegionsByCountry(form.country, form.date);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.country, form.date]);

  // --- Auto-select company by country ---
  useEffect(() => {
    const targetName = COUNTRY_COMPANY_MAP[form.country];
    if (!targetName) return;

    const match = companies.find((c) => (c.value || c.label) === targetName);
    if (match && form.companyName !== match.value) {
      setForm((prev) => ({ ...prev, companyName: match.value }));
    }
  }, [form.country, companies]);

  function handleChange(e) {
    const { name, value } = e.target;
    const nextForm = { ...form, [name]: value };

    if (name === "date") {
      fetchCountriesByYear(value);
    }

    if (name === "country") {
      nextForm.region = "";
    }

    if (["date", "country", "region"].includes(name)) {
      const dateVal = name === "date" ? value : nextForm.date;
      const countryVal = name === "country" ? value : nextForm.country;
      const regionVal = name === "region" ? value : nextForm.region;

      if (dateVal && countryVal) {
        const year = dateVal.slice(0, 4);
        const monthNum = dateVal.slice(5, 7);
        const monthIdx = parseInt(monthNum, 10) - 1;
        const monthName = MONTH_NAMES[monthIdx] || "";
        const dayNum = dateVal.slice(8, 10);
        const monthFormatted = `${monthNum}_${monthName}`;
        const dayFormatted = `${dayNum}_${monthName}`;

        nextForm.folderPath = regionVal
          ? `${onedriveBase}/${year}/${countryVal}/${regionVal}/${monthFormatted}/${dayFormatted}`
          : `${onedriveBase}/${year}/${countryVal}/${monthFormatted}/${dayFormatted}`;
      }
    }

    setForm(nextForm);
  }

  function handleSubmit(e) {
    e.preventDefault();

    const missing = [];
    if (!form.companyName?.trim()) missing.push("Company Name");
    if (!form.country?.trim()) missing.push("Country");
    if (regions.length > 0 && !form.region?.trim()) missing.push("Region");
    if (!form.date?.trim()) missing.push("Date");
    if (!form.category?.trim()) missing.push("Category");
    if (missing.length) {
      alert(
        `Please complete all required fields before proceeding:\n${missing.join(
          ", "
        )}`
      );
      return;
    }

    onSearch?.(form); // send form data up to App
  }

  function fetchCountriesByYear(date) {
    const year = date.slice(0, 4);
    const url = `${API_BASE}/api/country?year=${year}`;

    fetchJson(url)
      .then((data) => {
        if (Array.isArray(data?.countries)) {
          setCountries(
            data.countries.map((name) => ({ label: name, value: name }))
          );
          setForm((prev) => ({ ...prev, country: data.countries[0] || "" }));
        }
      })
      .catch((err) => {
        console.error("Failed to load countries:", err);
      });
  }

  function fetchRegionsByCountry(country, date) {
    const year = date.slice(0, 4);
    const url = `${API_BASE}/api/regions?country=${encodeURIComponent(
      country
    )}&year=${year}`;

    fetchJson(url)
      .then((data) => {
        if (Array.isArray(data?.regions)) {
          setRegions(
            data.regions.map((name) => ({ label: name, value: name }))
          );
        }
      })
      .catch((err) => {
        console.error("Failed to load regions:", err);
      });
  }

  return (
    <aside className="h-screen w-full max-w-[320px] shrink-0 border-r border-gray-200 bg-white p-4 overflow-y-auto">
      <form onSubmit={handleSubmit} className="grid gap-4 cursor-pointer">
        {/* BC Environment dropdown */}
        <SelectField
          label={required("🌐 BC Environment")}
          name="bcEnv"
          value={bcEnv}
          onChange={(e) => {
            const value = e.target.value;
            setBcEnv(value);

            // Notify backend to update global BC env
            fetch(`${API_BASE}/api/config/set_bc_env`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ env_name: value }),
            }).catch((err) => {
              console.error("Failed to update BC Environment:", err);
            });
          }}
          options={envOptions}
        />

        <hr className="border-t border-gray-200 my-2" />

        <SelectField
          label={required("🏢 Company Name")}
          name="companyName"
          value={form.companyName}
          onChange={handleChange}
          options={companies}
        />

        <hr className="border-t border-gray-200 my-2" />

        <SelectField
          label={required("🌏 Country")}
          name="country"
          value={form.country}
          onChange={handleChange}
          options={countries}
        />

        {regions.length > 0 && (
          <>
            <hr className="border-t border-gray-200 my-2" />
            <SelectField
              label={required("📍 Region")}
              name="region"
              value={form.region}
              onChange={handleChange}
              options={regions}
            />
          </>
        )}

        <hr className="border-t border-gray-200 my-2" />

        <DateField
          label={required("📅 Date")}
          name="date"
          value={form.date}
          onChange={handleChange}
        />

        <hr className="border-t border-gray-200 my-2" />

        <TextField
          label={required("📁 Folder Path")}
          name="folderPath"
          value={form.folderPath}
          onChange={handleChange}
          placeholder="/shared/documents/..."
          readOnly
        />

        <hr className="border-t border-gray-200 my-2" />

        <SelectField
          label={required("🗂️ Category")}
          name="category"
          value={form.category}
          onChange={handleChange}
          options={categories}
        />

        <button
          type="submit"
          disabled={loading}
          className={`inline-flex w-full items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition cursor-pointer ${
            loading
              ? "bg-gray-400 text-white cursor-not-allowed"
              : "bg-gray-500 text-white hover:bg-gray-600"
          }`}
        >
          Search
        </button>
      </form>
    </aside>
  );
}
