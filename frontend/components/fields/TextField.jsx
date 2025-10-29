import React from 'react';
export default function TextField({ label, ...props }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <input
        type="text"
        {...props}
        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2"
      />
    </label>
  );
}