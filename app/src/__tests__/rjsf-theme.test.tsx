import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { WidgetProps, FieldTemplateProps } from "@rjsf/utils";
import {
  TextWidget,
  TextareaWidget,
  NumberWidget,
  CheckboxWidget,
  SelectWidget,
  FieldTemplate,
} from "@stac-higher/shared";

// jsdom doesn't implement scrollIntoView — Radix UI Select calls it when opening
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

// Minimal stub for WidgetProps — only include fields used by the widgets
function makeWidgetProps(overrides: Partial<WidgetProps> = {}): WidgetProps {
  return {
    id: "test-field",
    value: undefined,
    required: false,
    disabled: false,
    readonly: false,
    placeholder: "",
    label: "Test Label",
    onChange: vi.fn(),
    onBlur: vi.fn(),
    onFocus: vi.fn(),
    options: {},
    schema: {},
    uiSchema: {},
    formContext: {},
    autofocus: false,
    rawErrors: [],
    registry: {} as WidgetProps["registry"],
    ...overrides,
  } as unknown as WidgetProps;
}

// Minimal stub for FieldTemplateProps
function makeFieldTemplateProps(overrides: Partial<FieldTemplateProps> = {}): FieldTemplateProps {
  return {
    id: "test-field",
    label: "Test Label",
    required: false,
    hidden: false,
    displayLabel: true,
    rawDescription: "",
    errors: null,
    children: <input />,
    schema: {},
    uiSchema: {},
    formContext: {},
    registry: {} as FieldTemplateProps["registry"],
    ...overrides,
  } as unknown as FieldTemplateProps;
}

describe("TextWidget", () => {
  it("renders an input with the given value", () => {
    render(<TextWidget {...makeWidgetProps({ id: "name", value: "hello" })} />);
    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("hello");
  });

  it("calls onChange with string value on input", () => {
    const onChange = vi.fn();
    render(<TextWidget {...makeWidgetProps({ onChange })} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "world" } });
    expect(onChange).toHaveBeenCalledWith("world");
  });

  it("calls onChange with undefined when cleared", () => {
    const onChange = vi.fn();
    render(<TextWidget {...makeWidgetProps({ onChange, value: "foo" })} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("is disabled when disabled prop is true", () => {
    render(<TextWidget {...makeWidgetProps({ disabled: true })} />);
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("is disabled when readonly prop is true", () => {
    render(<TextWidget {...makeWidgetProps({ readonly: true })} />);
    expect(screen.getByRole("textbox")).toBeDisabled();
  });
});

describe("TextareaWidget", () => {
  it("renders a textarea with the given value", () => {
    render(<TextareaWidget {...makeWidgetProps({ value: "multi\nline" })} />);
    const textarea = screen.getByRole("textbox");
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea).toHaveValue("multi\nline");
  });

  it("calls onChange with string value on input", () => {
    const onChange = vi.fn();
    render(<TextareaWidget {...makeWidgetProps({ onChange })} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "typed" } });
    expect(onChange).toHaveBeenCalledWith("typed");
  });

  it("calls onChange with undefined when cleared", () => {
    const onChange = vi.fn();
    render(<TextareaWidget {...makeWidgetProps({ onChange, value: "foo" })} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});

describe("NumberWidget", () => {
  it("renders a number input with the given value", () => {
    render(<NumberWidget {...makeWidgetProps({ id: "qty", value: 42 })} />);
    const input = screen.getByRole("spinbutton");
    expect(input).toHaveValue(42);
  });

  it("calls onChange with a number on input", () => {
    const onChange = vi.fn();
    render(<NumberWidget {...makeWidgetProps({ onChange })} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "7" } });
    expect(onChange).toHaveBeenCalledWith(7);
  });

  it("calls onChange with undefined when cleared", () => {
    const onChange = vi.fn();
    render(<NumberWidget {...makeWidgetProps({ onChange, value: 5 })} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});

describe("CheckboxWidget", () => {
  it("renders a switch that is unchecked when value is false", () => {
    render(<CheckboxWidget {...makeWidgetProps({ id: "active", value: false })} />);
    const toggle = screen.getByRole("switch");
    expect(toggle).not.toBeChecked();
  });

  it("renders a switch that is checked when value is true", () => {
    render(<CheckboxWidget {...makeWidgetProps({ id: "active", value: true })} />);
    const toggle = screen.getByRole("switch");
    expect(toggle).toBeChecked();
  });

  it("calls onChange when toggled", () => {
    const onChange = vi.fn();
    render(<CheckboxWidget {...makeWidgetProps({ id: "active", onChange, value: false })} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("renders a label when label prop is provided", () => {
    render(<CheckboxWidget {...makeWidgetProps({ label: "Enable feature" })} />);
    expect(screen.getByText("Enable feature")).toBeInTheDocument();
  });

  it("is disabled when disabled prop is true", () => {
    render(<CheckboxWidget {...makeWidgetProps({ disabled: true })} />);
    expect(screen.getByRole("switch")).toBeDisabled();
  });
});

describe("SelectWidget", () => {
  const enumOptions = [
    { value: "a", label: "Option A" },
    { value: "b", label: "Option B" },
  ];

  it("renders a select trigger", () => {
    render(
      <SelectWidget
        {...makeWidgetProps({
          id: "color",
          options: { enumOptions },
        })}
      />,
    );
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("shows None option when not required", () => {
    render(
      <SelectWidget
        {...makeWidgetProps({
          id: "color",
          required: false,
          options: { enumOptions },
        })}
      />,
    );
    // Open the dropdown to see options
    fireEvent.click(screen.getByRole("combobox"));
    // Radix renders selected item both in trigger and listbox — use getAllByText
    expect(screen.getAllByText("None").length).toBeGreaterThan(0);
  });

  it("does not show None option when required", () => {
    render(
      <SelectWidget
        {...makeWidgetProps({
          id: "color",
          required: true,
          options: { enumOptions },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.queryByText("None")).not.toBeInTheDocument();
  });

  it("shows enum option labels when open", () => {
    render(
      <SelectWidget
        {...makeWidgetProps({
          id: "color",
          options: { enumOptions },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.getByText("Option A")).toBeInTheDocument();
    expect(screen.getByText("Option B")).toBeInTheDocument();
  });
});

describe("FieldTemplate", () => {
  it("renders the label when displayLabel is true", () => {
    render(<FieldTemplate {...makeFieldTemplateProps({ label: "My Field", displayLabel: true })} />);
    expect(screen.getByText("My Field")).toBeInTheDocument();
  });

  it("does not render label when displayLabel is false", () => {
    render(<FieldTemplate {...makeFieldTemplateProps({ label: "My Field", displayLabel: false })} />);
    expect(screen.queryByText("My Field")).not.toBeInTheDocument();
  });

  it("renders required indicator when required is true", () => {
    render(
      <FieldTemplate
        {...makeFieldTemplateProps({ label: "My Field", displayLabel: true, required: true })}
      />,
    );
    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("renders description when provided", () => {
    render(
      <FieldTemplate
        {...makeFieldTemplateProps({ rawDescription: "This is a description" })}
      />,
    );
    expect(screen.getByText("This is a description")).toBeInTheDocument();
  });

  it("renders errors when provided", () => {
    render(
      <FieldTemplate
        {...makeFieldTemplateProps({ errors: <span>Required field</span> })}
      />,
    );
    expect(screen.getByText("Required field")).toBeInTheDocument();
  });

  it("hides content when hidden is true", () => {
    const { container } = render(
      <FieldTemplate
        {...makeFieldTemplateProps({ hidden: true, label: "Hidden Field", displayLabel: true })}
      />,
    );
    // When hidden, FieldTemplate renders <div className="hidden">{children}</div>
    // The label is not rendered — only children inside a hidden wrapper
    expect(container.querySelector(".hidden")).toBeInTheDocument();
  });
});
