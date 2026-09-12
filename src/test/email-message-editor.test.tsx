import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import EmailMessageEditor from "@/components/EmailMessageEditor";

function Editor() {
  const [subject, setSubject] = useState("Hello client");
  const [body, setBody] = useState("Your session");
  return <EmailMessageEditor subject={subject} body={body} onSubjectChange={setSubject} onBodyChange={setBody} variables={[{ variable: "{{firstName}}", description: "First name" }]} />;
}

describe("email template editing", () => {
  it("inserts a placeholder at the selection in the active field", () => {
    render(<Editor />);
    const subject = screen.getByLabelText("Subject") as HTMLInputElement;
    fireEvent.focus(subject);
    subject.setSelectionRange(6, 12);
    fireEvent.click(screen.getByText("{{firstName}}"));
    expect(subject.value).toBe("Hello {{firstName}}");
    expect(screen.getByLabelText("Message")).toHaveValue("Your session");
  });
});
