interface TabBarProps<T extends string> {
  value: T;
  tabs: Array<{
    id: T;
    label: string;
  }>;
  onChange: (value: T) => void;
}

export function TabBar<T extends string>({
  value,
  tabs,
  onChange
}: TabBarProps<T>) {
  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={tab.id === value ? "tab active" : "tab"}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
