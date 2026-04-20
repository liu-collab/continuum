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
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {options ? (
        <select name={name} defaultValue={defaultValue ?? ""} className="field">
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
          className="field"
        />
      )}
    </label>
  );
}
