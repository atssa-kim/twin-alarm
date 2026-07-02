import React, { useState } from 'react';
import { EQUIPMENT_DATA } from '../data/equipmentData';

export const EquipmentView: React.FC = () => {
  const [selected, setSelected] = useState(EQUIPMENT_DATA[0].key);
  const current = EQUIPMENT_DATA.find(d => d.key === selected)!;

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'row', overflow: 'hidden',
      width: '100%', boxSizing: 'border-box',
    }}>
      {/* 좌측 재난 세로 메뉴 */}
      <aside style={{
        width: '68px', flexShrink: 0,
        display: 'flex', flexDirection: 'column', gap: '2px',
        padding: '8px 4px',
        borderRight: '1px solid rgba(255,255,255,0.07)',
        overflowY: 'auto',
      }}>
        {EQUIPMENT_DATA.map(d => {
          const active = d.key === selected;
          return (
            <button
              key={d.key}
              onClick={() => setSelected(d.key)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: '3px', padding: '10px 4px', borderRadius: '10px',
                border: 'none', cursor: 'pointer',
                background: active ? `${d.color}22` : 'transparent',
                outline: active ? `1.5px solid ${d.color}66` : 'none',
                transition: 'all 0.15s',
              }}
            >
              <span style={{ fontSize: '18px', lineHeight: 1 }}>{d.icon}</span>
              <span style={{
                fontSize: '9px', fontWeight: 700, lineHeight: 1.2, textAlign: 'center',
                color: active ? d.color : '#64748b',
                wordBreak: 'keep-all',
              }}>
                {d.label}
              </span>
            </button>
          );
        })}
      </aside>

      {/* 우측 장비 카드 목록 */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '8px 10px',
        display: 'flex', flexDirection: 'column', gap: '7px',
      }}>
        {/* 헤더 */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '6px 2px', marginBottom: '2px',
        }}>
          <span style={{ fontSize: '18px' }}>{current.icon}</span>
          <span style={{ fontWeight: 800, fontSize: '14px', color: current.color }}>
            {current.label}
          </span>
          <span style={{
            marginLeft: 'auto', fontSize: '11px', fontWeight: 700,
            color: '#475569', background: 'rgba(255,255,255,0.05)',
            padding: '2px 8px', borderRadius: '6px',
          }}>
            {current.items.length}종
          </span>
        </div>

        {/* 장비 카드 */}
        {current.items.map((item, i) => (
          <div
            key={i}
            style={{
              background: 'rgba(15,23,42,0.6)',
              border: `1px solid ${current.color}22`,
              borderRadius: '12px', padding: '10px 12px',
            }}
          >
            {/* 장비명 + 수량 */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '6px', marginBottom: '3px' }}>
              <span style={{ fontWeight: 800, fontSize: '13px', color: '#f1f5f9', lineHeight: 1.3 }}>
                {item.name}
              </span>
              <span style={{
                flexShrink: 0, fontSize: '12px', fontWeight: 800,
                color: current.color, background: `${current.color}18`,
                padding: '1px 7px', borderRadius: '6px', lineHeight: 1.6,
              }}>
                {item.qty}
              </span>
            </div>

            {/* 규격 */}
            {item.spec && (
              <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '5px' }}>
                {item.spec}
              </div>
            )}

            {/* 보관 위치 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {item.locations.map((loc, j) => (
                <div key={j} style={{ display: 'flex', alignItems: 'flex-start', gap: '4px' }}>
                  <span style={{ fontSize: '10px', flexShrink: 0, marginTop: '1px' }}>📍</span>
                  <span style={{ fontSize: '11px', color: '#93c5fd', lineHeight: 1.4 }}>
                    {loc}
                  </span>
                </div>
              ))}
            </div>

            {/* 비고 */}
            {item.note && (
              <div style={{
                marginTop: '5px', fontSize: '10px', color: '#f59e0b',
                background: 'rgba(245,158,11,0.08)', borderRadius: '5px',
                padding: '3px 6px',
              }}>
                ⚠️ {item.note}
              </div>
            )}
          </div>
        ))}

        <div style={{ height: '8px' }} />
      </div>
    </div>
  );
};
