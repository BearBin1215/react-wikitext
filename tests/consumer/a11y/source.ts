export const ARTICLE = `Lead paragraph with [[Internal page|internal label]] and [https://example.com external link].

== Alpha ==
Text under alpha with a footnote<ref name="a">First note</ref>.

=== Nested ===
More text with reuse<ref name="a" /> and an image [[File:Local.svg|thumb|Local caption]].

A missing image [[File:Missing.png|thumb|Missing caption]] stays a placeholder.

== Beta ==
{| class="wikitable"
|+ Caption
! Header !! Second
|-
| one || two
|}

== Nested table ==
{|
| outer
| {| inner |}
|}

== Unsupported ==
<custom>kept as a source card</custom>

[[Category:Demo]]
`;
