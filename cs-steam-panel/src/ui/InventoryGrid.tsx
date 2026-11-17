"use client";

type Item = {
  assetId: string;
  name: string;
  type: string;
  icon: string;
  rarity: string;
};

export function InventoryGrid({ items }: { items: Item[] }) {
  if (!items.length) return <p className="muted">Инвентарь пуст или Steam скрыл профиль.</p>;
  return (
    <div className="inv">
      {items.map((it) => (
        <div className="it" key={it.assetId} title={it.type}>
          {it.icon ? <img src={it.icon} alt="" /> : <div style={{ height: 48 }} />}
          <div className="n">{it.name}</div>
          {it.rarity ? <div className="muted">{it.rarity}</div> : null}
        </div>
      ))}
    </div>
  );
}
