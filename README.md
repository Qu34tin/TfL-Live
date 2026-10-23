# London Tube Now

please rework this website https://www.londonunderground.live/

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://london-tube-now.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/add3575a-81dc-572d-99b8-c002ce606f55).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

The live map uses MapTiler vector tiles. Copy `.env.example` to `.env.local` and add your
MapTiler public key as `VITE_MAPTILER_KEY`. The map loads live Tube train actions and TfL route,
arrival, and status data for the Elizabeth line, DLR, Tram, and all six London Overground lines.
Metropolitan, DLR, and Tram rail paths are detailed OpenStreetMap geometries stored in
`public/data/rail-track-geometries.json` and credited to OpenStreetMap contributors (ODbL).
Overground paths and station-to-station train tracks use TfL's real geographic route geometry.

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
