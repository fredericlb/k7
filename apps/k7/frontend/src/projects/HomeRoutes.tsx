// HomeRoutes.tsx — the pages with no project in the address, as ROUTES so going between them reloads nothing, with the
// rehearsal take and the home frame (the sidebar's fold, the bar's dock) held above them so they outlive every one. A chunk of its own: a project page never loads the
// rehearsal package or these pages (../../docs/shell.md).

import { RehearsalRecording } from "@studio/ui-rehearsal";
import { lazy, type ReactNode, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { useServerChoice } from "../serverChoice";
import {
  ABOUT_ROUTE,
  ENGINE_SETTINGS_ROUTE,
  LIBRARIES_ROUTE,
  MEDIA_ROUTE,
  REHEARSAL_ROUTE,
  SERVER_SETTINGS_ROUTE,
  SETTINGS_ROUTE,
  TASKS_ROUTE,
} from "./api";
import { Home } from "./Home";
import { HomeFrame } from "./HomeFrame";
import { RehearsalHost } from "./RehearsalHost";
import { RehearsalPage } from "./RehearsalPage";

/** The home's other pages, fetched when visited: the médiathèque carries the editor stack the login and home pages must not wait for (docs/audit.md). */
const LibrariesPage = lazy(() =>
  import("./LibrariesPage").then((m) => ({
    default: m.LibrariesPage,
  })),
);
const MediaPage = lazy(() =>
  import("./MediaPage").then((m) => ({ default: m.MediaPage })),
);
const TasksPage = lazy(() =>
  import("./TasksPage").then((m) => ({ default: m.TasksPage })),
);
const EnginePage = lazy(() =>
  import("../settings/EnginePage").then((m) => ({
    default: m.EnginePage,
  })),
);
const ServerPage = lazy(() =>
  import("../settings/ServerPage").then((m) => ({
    default: m.ServerPage,
  })),
);
const SettingsPage = lazy(() =>
  import("../settings/SettingsPage").then((m) => ({
    default: m.SettingsPage,
  })),
);
const AboutPage = lazy(() =>
  import("../about/AboutPage").then((m) => ({ default: m.AboutPage })),
);

export function HomeRoutes({ fallback }: { fallback: ReactNode }) {
  const serverChoice = useServerChoice();
  return (
    <RehearsalHost>
      {/* The sidebar's fold and the bar's dock, shared by every page below (HomeFrame.tsx). */}
      <HomeFrame>
        <RehearsalRecording>
          {/* Inside the take's holder, so a page arriving never hides the take in progress. */}
          <Suspense fallback={fallback}>
            {/* Keyed by the server picker: a page read from one server keeps nothing of it on the other. */}
            <Routes key={serverChoice}>
              <Route path={LIBRARIES_ROUTE} element={<LibrariesPage />} />
              <Route path={SETTINGS_ROUTE} element={<SettingsPage />} />
              <Route path={ENGINE_SETTINGS_ROUTE} element={<EnginePage />} />
              <Route path={SERVER_SETTINGS_ROUTE} element={<ServerPage />} />
              <Route path={ABOUT_ROUTE} element={<AboutPage />} />
              <Route path={TASKS_ROUTE} element={<TasksPage />} />
              <Route path={`${MEDIA_ROUTE}/*`} element={<MediaPage />} />
              <Route
                path={`${REHEARSAL_ROUTE}/*`}
                element={<RehearsalPage />}
              />
              <Route path="*" element={<Home />} />
            </Routes>
          </Suspense>
        </RehearsalRecording>
      </HomeFrame>
    </RehearsalHost>
  );
}
