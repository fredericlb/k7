# The root domain

`k7.rocks` and `www.k7.rocks` show ONE page: the startup splash every app opens on
(`apps/k7/frontend/docs/icons.md`), on its #07031F, and "Coming soon". The app is at `app.k7.rocks`.

## Choices

| choice | why |
|---|---|
| served by k7's backend (`src/sitePage.ts`), on a Traefik router of its own (`k7-site` in `docker/docker-compose.yml`) | the hosted app is one image with no nginx; a second container for one static page is a second thing to deploy and watch |
| the hosts default to `k7.rocks` and `www.k7.rocks`, and `$STUDIO_SITE_HOSTS` replaces them | the server's compose file is its own copy, which a deploy does not update: a page that waited for a variable there did not show. No dev session, other server or desktop is ever asked for those two names, so the default reaches nothing else |
| mounted before the session, the routes and the SPA | a visitor of the front page is no user of the app; nothing else of k7 answers on those hosts |
| `/app_downloads` and `/favicon.ico` still pass | the installed apps read their update feed at `https://k7.rocks/app_downloads` ([docs/app-downloads.md](../../../../docs/app-downloads.md)) |
| every other address answers a redirect to `/` | a link into the app on the wrong host lands on the page rather than on a 404 |
| the drawing inlined, from `apps/k7/frontend/icon/k7-splash.inline.json` | the page fetches nothing, and the backend's bundle carries the drawing without reading a file at run time |

Both names need a DNS record pointing at the server: Traefik asks Let's Encrypt for each.
