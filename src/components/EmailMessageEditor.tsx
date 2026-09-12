import { useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export default function EmailMessageEditor({ subject, body, onSubjectChange, onBodyChange, variables, disabled = false }: {
  subject: string; body: string; onSubjectChange: (value: string) => void; onBodyChange: (value: string) => void;
  variables: { variable: string; description: string }[]; disabled?: boolean;
}) {
  const id = useId();
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [active, setActive] = useState<"subject" | "body">("body");
  const insertVariable = (variable: string) => {
    const field = active === "subject" ? subjectRef.current : bodyRef.current;
    const value = active === "subject" ? subject : body;
    const start = field?.selectionStart ?? value.length;
    const end = field?.selectionEnd ?? start;
    (active === "subject" ? onSubjectChange : onBodyChange)(value.slice(0, start) + variable + value.slice(end));
    requestAnimationFrame(() => { field?.focus(); field?.setSelectionRange(start + variable.length, start + variable.length); });
  };
  return <fieldset disabled={disabled} className="space-y-3 min-w-0">
    <div>
      <label htmlFor={`${id}-subject`} className="block mb-1.5 text-xs font-body text-muted-foreground">Subject</label>
      <Input id={`${id}-subject`} ref={subjectRef} value={subject} onFocus={() => setActive("subject")} onChange={event => onSubjectChange(event.target.value)} placeholder="Your {{eventTitle}} session" />
    </div>
    <div>
      <label htmlFor={`${id}-body`} className="block mb-1.5 text-xs font-body text-muted-foreground">Message</label>
      <Textarea id={`${id}-body`} ref={bodyRef} value={body} onFocus={() => setActive("body")} onChange={event => onBodyChange(event.target.value)} placeholder={"Hi {{firstName}},\n\nWrite your message here."} className="min-h-[220px] text-sm leading-7" />
      <p className="mt-1.5 text-xs text-muted-foreground">Blank lines create paragraphs. Your message uses the studio email layout.</p>
    </div>
    <details className="rounded-lg border border-border p-3">
      <summary className="cursor-pointer text-xs text-muted-foreground">Insert client or session details</summary>
      <div className="mt-3 flex flex-wrap gap-2">
        {variables.map(({ variable, description }) => <button key={variable} type="button" title={description} onMouseDown={event => event.preventDefault()} onClick={() => insertVariable(variable)} className="rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-secondary">{variable}</button>)}
      </div>
    </details>
  </fieldset>;
}
