type FormFieldProps = {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
  type?: "text" | "date";
};

export function FormField({
  label,
  name,
  defaultValue,
  placeholder,
  options,
  type = "text"
}: FormFieldProps) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {options ? (
        <select
          name={name}
          defaultValue={defaultValue ?? ""}
          className="rounded-xl border bg-white px-3 py-2 text-sm text-slate-900"
        >
          <option value="">全部</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          name={name}
          type={type}
          defaultValue={defaultValue ?? ""}
          placeholder={placeholder}
          className="rounded-xl border bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
        />
      )}
    </label>
  );
}
