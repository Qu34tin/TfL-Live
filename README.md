# TfL Live

Live London transit status, departure boards, and moving trains on a map.

## Cloudflare deployments

The existing Cloudflare Worker build remains the default:

```sh
bun run build
```

To build for a separate Cloudflare Pages project, use:

```sh
bun run build:pages
```

Configure the Pages project with `bun run build:pages` as its build command and
`dist` as its build output directory. Set `VITE_MAPTILER_KEY` in the Pages
project's production build variables so Vite can include it in the browser
bundle. This is a public client-side map key; restrict it to the deployed
domains in MapTiler and do not commit `.env.local`.

## JS.ORG

JS.ORG requires a deployed site with substantive content and reviews requests
for eligibility. The service says sites should be directly related to the
JavaScript ecosystem, so this transit tracker may not qualify merely because it
is built with JavaScript.

For Cloudflare Pages hosting, first deploy the Pages project and then add the
requested JS.ORG subdomain to that Pages project as a custom domain through the
Cloudflare Pages API. JS.ORG's [hosting notes](https://github.com/js-org/js.org/wiki/3rd-party-hosts)
explain this requirement. Once the Pages site is ready, request an available
subdomain with a pull request to the
[JS.ORG domain list](https://github.com/js-org/js.org/blob/master/cnames_active.js),
following its [submission instructions](https://github.com/js-org/js.org#github-pages).
