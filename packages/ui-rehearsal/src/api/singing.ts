// singing.ts — the singing exercises' calls.

import type { SingingExercise } from "../types";
import { f, json } from "./http";

export const singingApi = {
  // --- Singing exercises (a personal practice book) ---
  listSingingExercises: (): Promise<SingingExercise[]> =>
    f("/api/singing").then(json),

  createSingingExercise: (data: {
    title: string;
    description: string;
    videoUrl: string;
  }): Promise<SingingExercise> =>
    f("/api/singing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(json),

  updateSingingExercise: (
    id: string,
    patch: { title?: string; description?: string; videoUrl?: string },
  ): Promise<SingingExercise> =>
    f(`/api/singing/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(json),

  deleteSingingExercise: (id: string): Promise<null> =>
    f(`/api/singing/${id}`, { method: "DELETE" }).then(json),
};
