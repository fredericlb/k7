// ReleaseFields.tsx — a release's own fields, the same on the new-release form and on its page's
// edit form: title, artist, date, description, and whether it may be downloaded.

import { Field } from "@frediverse/ui/field";
import { Input } from "@frediverse/ui/input";
import { Textarea } from "@frediverse/ui/textarea";
import type { ReactNode } from "react";
import { m } from "../paraglide/messages.js";
import { SwitchField } from "./SwitchField";

export interface ReleaseFieldValues {
  title: string;
  artist: string;
  releaseDate: string;
  description: string;
  canDownload: boolean;
}

interface Props {
  values: ReleaseFieldValues;
  onChange: (values: ReleaseFieldValues) => void;
  /** What a form adds between the description and the download switch. */
  children?: ReactNode;
}

export function ReleaseFields({ values, onChange, children }: Props) {
  const set = <K extends keyof ReleaseFieldValues>(
    key: K,
    value: ReleaseFieldValues[K],
  ) => onChange({ ...values, [key]: value });

  return (
    <>
      <Field label={m["field.title"]()}>
        <Input
          value={values.title}
          onChange={(e) => set("title", e.target.value)}
        />
      </Field>

      <Field label={m["field.artist"]()}>
        <Input
          value={values.artist}
          onChange={(e) => set("artist", e.target.value)}
        />
      </Field>

      <Field label={m["release.dateLabel"]()}>
        <Input
          type="date"
          value={values.releaseDate}
          onChange={(e) => set("releaseDate", e.target.value)}
        />
      </Field>

      <Field label={m["release.descriptionLabel"]()}>
        <Textarea
          rows={3}
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </Field>

      {children}

      <SwitchField
        checked={values.canDownload}
        onCheckedChange={(on) => set("canDownload", on)}
        className="mb-4 mt-2"
      >
        {m["release.allowDownload"]()}
      </SwitchField>
    </>
  );
}
