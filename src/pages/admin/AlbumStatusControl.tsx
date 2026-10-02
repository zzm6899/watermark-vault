export default function AlbumStatusControl({ proofing, value, bookingStatus, disabled, onChange }: {
  proofing: boolean;
  value: string;
  bookingStatus?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return <div className="flex items-center gap-2 flex-wrap">
    <select aria-label="Gallery status" value={value} disabled={disabled} onClick={(event) => event.stopPropagation()} onChange={(event) => { event.stopPropagation(); onChange(event.target.value); }} className="text-[11px] font-body px-1 py-1 border-0 border-b border-border rounded-none bg-transparent text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-wait disabled:opacity-60">
      {proofing ? <>
        <option value="proofing">Proofing</option><option value="selections-submitted">Picks submitted</option><option value="editing">Editing</option><option value="finals-delivered">Finals delivered</option>
      </> : <>
        <option value="editing">Editing</option><option value="proofing">Proofing</option><option value="delivered">Delivered</option><option value="archived">Archived</option>
      </>}
    </select>
    {bookingStatus && <span className="text-[10px] text-muted-foreground" title="Linked booking status">Booking: {bookingStatus}</span>}
  </div>;
}
