insert into public.project_files (project_id, path, content) values ('71aa7384-bb51-4c76-b29a-7fd5e231ad6c', 'src/components/ui/sonner.tsx', '// Re-exports sonner for a familiar shadcn-style toast API.
// Mount <Toaster /> once at the root, then call `toast(...)`, `toast.success(...)`, etc.
export { Toaster } from "sonner";
export { toast } from "sonner";
') on conflict (project_id, path) do update set content = excluded.content;
insert into public.project_files (project_id, path, content) values ('71aa7384-bb51-4c76-b29a-7fd5e231ad6c', 'src/components/ui/form.tsx', 'import * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type FormErrorMap<T> = { [K in keyof T]?: string };

export function useForm<T extends Record<string, unknown>>(opts: {
  defaults: T;
  validate?: (values: T) => FormErrorMap<T>;
  onSubmit: (values: T) => void | Promise<void>;
}) {
  const [values, setValues] = React.useState<T>(opts.defaults);
  const [errors, setErrors] = React.useState<FormErrorMap<T>>({});
  const [touched, setTouched] = React.useState<Partial<Record<keyof T, boolean>>>({});
  const [submitting, setSubmitting] = React.useState(false);

  const setValue = React.useCallback(<K extends keyof T>(name: K, value: T[K]) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const register = React.useCallback(<K extends keyof T & string>(name: K) => ({
    name,
    value: values[name] as unknown as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setValue(name, e.target.value as unknown as T[K]);
    },
    onBlur: () => setTouched((t) => ({ ...t, [name]: true })),
  }), [values, setValue]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const errs = opts.validate?.(values) ?? {};
    setErrors(errs);
    const allTouched = Object.keys(values).reduce((acc, k) => ({ ...acc, [k]: true }), {});
    setTouched(allTouched as Partial<Record<keyof T, boolean>>);
    if (Object.values(errs).some((v) => v)) return;
    setSubmitting(true);
    try {
      await opts.onSubmit(values);
    } finally {
      setSubmitting(false);
    }
  };

  const reset = (next?: T) => { setValues(next ?? opts.defaults); setErrors({}); setTouched({}); };

  return { values, errors, touched, submitting, setValue, register, handleSubmit, reset };
}

export function Form(props: any) {
  const { className, children, control, handleSubmit, formState, watch, register, ...rest } = props ?? {};
  const isRhf = Boolean(control || formState || (handleSubmit && watch));
  if (isRhf) return <>{children}</>;
  return <form className={cn("space-y-4", className)} {...rest}>{children}</form>;
}

function rhfField(control: any, name: string) {
  if (control && typeof control.register === "function") {
    try {
      const reg = control.register(name);
      const values = control._formValues || control._defaultValues || {};
      return { ...reg, defaultValue: values[name] };
    } catch {
      // fall through to the inert field below
    }
  }
  return {
    name,
    value: "",
    onChange: () => {},
    onBlur: () => {},
    ref: () => {},
  };
}

export function FormField(props: any) {
  const { name, label, description, error, className, children, control, render } = props ?? {};
  let body: React.ReactNode = children;
  if (typeof render === "function") {
    body = render({ field: rhfField(control, name), fieldState: { error: undefined }, formState: {} });
  }
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && <Label htmlFor={name}>{label}</Label>}
      {body}
      {description && !error && <p className="text-xs text-muted-foreground">{description}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function FormErrors({ errors, className }: { errors?: Record<string, any>; className?: string }) {
  const list = Object.values(errors ?? {})
    .map((e: any) => (typeof e === "string" ? e : e?.message))
    .filter(Boolean) as string[];
  if (list.length === 0) return null;
  return (
    <div className={cn("rounded-md border border-destructive/30 bg-destructive/10 p-3", className)} role="alert">
      {list.map((msg, i) => (
        <p key={i} className="text-sm text-destructive">{msg}</p>
      ))}
    </div>
  );
}

export function FormItem({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-1.5", className)} {...props} />;
}
export function FormLabel(props: React.ComponentProps<typeof Label>) {
  return <Label {...props} />;
}
export function FormControl({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}
export function FormDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-xs text-muted-foreground", className)} {...props} />;
}
export function FormMessage({ className, children }: { className?: string; children?: React.ReactNode }) {
  if (!children) return null;
  return <p className={cn("text-xs text-destructive", className)}>{children}</p>;
}
') on conflict (project_id, path) do update set content = excluded.content;