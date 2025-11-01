/**
 * Cloudflare Worker for packages.electronjs.org
 *
 * This worker handles dynamic redirects for package version resolution.
 * It uses KV storage to map package names to their latest versions.
 *
 * Example flow:
 * - Request: packages.electronjs.org/asar/latest
 * - KV lookup: key "asar" -> value "4.0.1"
 * - Redirect: packages.electronjs.org/asar/v4.0.1
 *
 * If no KV entry is found, the request passes through to the Cloud Connector.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    /**
     * Matches:
     * /<package> or /<package>/ or /<package>/latest or /<package>/latest/
     * See: https://regex101.com/r/4UBpUz/1
     */
    const match = pathname.match(/^\/([^\/]+)(?:\/latest(\/.*)?|\/?)?$/);

    if (match) {
      const packageName = match[1];

      try {
        let version = await env.KV.get(packageName);

        if (!version) {
          console.info(
            `No version found for ${packageName} in KV. Querying npm registry...`
          );
          const _req = await fetch(
            `https://registry.npmjs.org/@electron/${packageName}/latest`
          );

          if (_req.ok) {
            const data: any = await _req.json();
            const npmVersion = data.version;

            if (npmVersion) {
              await env.KV.put(packageName, npmVersion, {
                expirationTtl: 600, // 10 minutes
              });
              version = npmVersion;
            } else {
              console.warn(
                `No version found for ${packageName} in npm registry response.`
              );
            }
          } else {
            console.warn(
              "failed to look up package from npm registry",
              _req.status
            );
          }
        } else {
          console.info(`Found version ${version} for ${packageName} in KV`);
        }

        const redirectPath = `/${packageName}/v${version}/index.html`;
        const redirectUrl = new URL(
          redirectPath,
          "https://packages.electronjs.org"
        );

        redirectUrl.search = url.search;

        return Response.redirect(redirectUrl.toString(), 302);
      } catch (error) {
        console.warn(
          `Error looking up package version for ${packageName}:`,
          error
        );
      }
    } else {
      return Response.redirect("https://packages.electronjs.org", 302);
    }

    return fetch(request);
  },
} satisfies ExportedHandler<Env>;
