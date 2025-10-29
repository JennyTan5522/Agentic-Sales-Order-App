import React from 'react';
export default function SelectField({ label, options, ...props }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <select
        {...props}
        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 cursor-pointer"
      >
        <option value="">Select...</option>
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </label>
  );
}