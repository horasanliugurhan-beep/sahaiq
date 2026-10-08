export function assignQuintile(items,higherIsBetter=true){const s=[...items].sort((a,b)=>higherIsBetter?b.val-a.val:a.val-b.val);const out=new Map();let pv,ps=5;s.forEach((x,i)=>{let q=i/s.length<.2?5:i/s.length<.4?4:i/s.length<.6?3:i/s.length<.8?2:1;if(pv!==undefined&&x.val===pv)q=ps;out.set(x.id,q);pv=x.val;ps=q});return out}
export function segmentOf(R,F,M){if(R>=4&&F>=4&&M>=4)return"champion";if(R<=2&&F>=3&&M>=3)return"at_risk";if(R<=2&&F<=2)return"dormant";if(R>=3&&F>=3)return"loyal";if(R>=4&&F<=2)return"new";return"standard"}
export function calculateRFM(customers) {
  // No purchase history has no RFM score and must not skew buyers' quintiles.
  const hasPurchase = (c) => c.hasPurchase !== false && c.frequency > 0;
  const buyers = customers.filter(hasPurchase);
  const rs = assignQuintile(buyers.map((c) => ({ id: c.id, val: c.recency_days })), false);
  const fs = assignQuintile(buyers.map((c) => ({ id: c.id, val: c.frequency })));
  const ms = assignQuintile(buyers.map((c) => ({ id: c.id, val: c.monetary })));
  return customers.map((c) => {
    if (!hasPurchase(c)) return { ...c, R: null, F: null, M: null, segment_key: "no_purchase" };
    const R = rs.get(c.id), F = fs.get(c.id), M = ms.get(c.id);
    return { ...c, R, F, M, segment_key: segmentOf(R, F, M) };
  });
}
