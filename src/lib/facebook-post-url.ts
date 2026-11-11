const hosts = new Set([
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "web.facebook.com",
  "mbasic.facebook.com",
]);

export function canonicalFacebookPost(input: string) {
  try {
    const url = new URL(
      /^https?:\/\//i.test(input.trim())
        ? input.trim()
        : `https://${input.trim()}`,
    );
    if (
      !hosts.has(url.hostname) ||
      url.username ||
      url.password ||
      url.port ||
      !["https:", "http:"].includes(url.protocol)
    )
      return null;
    const groupPage = url.pathname.match(/^\/groups\/([^/]+)\/?$/);
    const multiPermalinks = url.searchParams.getAll("multi_permalinks");
    if (
      groupPage &&
      multiPermalinks.length === 1 &&
      /^[A-Za-z0-9._-]+$/.test(multiPermalinks[0])
    )
      url.pathname = `/groups/${groupPage[1]}/posts/${multiPermalinks[0]}`;
    const match = url.pathname.match(
      /^\/(?:groups\/[^/]+\/(?:posts|permalink)|[^/]+\/posts)\/([A-Za-z0-9._-]+)\/?$/,
    );
    const id =
      match?.[1] ||
      (["/story.php", "/permalink.php"].includes(url.pathname)
        ? url.searchParams.get("story_fbid")
        : null);
    if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) return null;
    url.protocol = "https:";
    url.hostname = "www.facebook.com";
    url.hash = "";
    if (match) {
      url.search = "";
      url.pathname = url.pathname.replace(/\/$/, "");
    } else {
      const author = url.searchParams.get("id");
      if (!author || !/^\d+$/.test(author)) return null;
      url.pathname = "/permalink.php";
      url.search = new URLSearchParams({
        story_fbid: id,
        id: author,
      }).toString();
    }
    return { postUrl: url.toString(), postKey: `post:${id}` };
  } catch {
    return null;
  }
}

export function postBelongsToDestination(post: string, destination: string) {
  const canonical = canonicalFacebookPost(post);
  if (!canonical) return false;
  const actual = new URL(canonical.postUrl),
    wanted = new URL(destination);
  const group = wanted.pathname.match(/^\/groups\/([^/]+)/i)?.[1];
  if (group)
    return (
      actual.pathname.match(/^\/groups\/([^/]+)/i)?.[1]?.toLowerCase() ===
      group.toLowerCase()
    );
  const owner =
    wanted.pathname === "/profile.php"
      ? wanted.searchParams.get("id")
      : wanted.pathname.split("/").filter(Boolean).at(-1);
  return (
    !!owner &&
    (actual.pathname.split("/")[1]?.toLowerCase() === owner.toLowerCase() ||
      actual.searchParams.get("id") === owner)
  );
}
