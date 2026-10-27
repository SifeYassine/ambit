# Viewer And Metadata

[Back to manual index](index.md)

Ambit opens images and videos in media-specific viewers with shared Metadata and Workflow surfaces. Images offer zoom, versions, and optional AI actions; videos offer playback and original-file export.

## Open And Navigate The Viewer

Open the viewer from the library grid, timeline, maintenance result lists, or any place that offers View Image.

In the image viewer you can:

- move to the previous or next image with the side arrows or the Left Arrow and Right Arrow keys
- zoom in, zoom out, and reset the view from the bottom zoom controls
- use the mouse wheel to zoom and drag the image while zoomed
- toggle theater mode with `Z`
- show or hide the metadata sidebar with `I`
- close the viewer with `Esc`

Viewer controls can fade while you focus on the image. Move the pointer to show them again. Theater mode hides the sidebar and uses a darker image-focused view.

## Toolbar Actions

The top toolbar shows the filename and, when available, a Version indicator. Toolbar actions can include:

- Copy Image to Clipboard
- Open in Default App
- Theater Mode
- Share, when the operating system or browser supports sharing
- favorite an image with `F`
- pin or unpin with `P`
- Remove from Library
- Hide Sidebar or Show Sidebar
- Close

Remove from Library removes the image record from Ambit's active library. It does not delete the source image file from disk. Use Maintenance > Removed > Delete File only when you intentionally want source-file deletion through the OS trash flow.

## Metadata Sidebar

Both viewers initially open on Metadata. Explicit tab selections are remembered globally across images, videos, and app restarts. If a preferred tab is unavailable, the viewer temporarily shows Metadata without replacing the saved preference. Expanded metadata sections remain viewer-session state.

- Metadata: prompts, generator and model editors, generation parameters, provenance, and populated resource sections, including VAEs, upscale models, CLIP Vision, and detection models.
- Workflow: workflow inspection, copy, and download when recorded data is available.

For images, Workflow may disappear after Ambit confirms that no workflow was recorded. Video Workflow shows an explanatory empty state when no workflow is available. Use the arrow keys while a tab is focused to switch tabs; Home and End select the first and last tabs.

Photos and Other images show only Metadata. It shows captured time, camera and lens, exposure settings, attribution, and local GPS coordinates when available. Ambit stores and displays GPS coordinates locally and does not contact a map or network service.

### Photo coverage

Ambit reads selected embedded EXIF fields from JPEG, PNG eXIf, and WebP EXIF containers. Camera/capture, lens/exposure, orientation, attribution, and GPS fields are shown when supported values are present; GPS starts collapsed. This is not an all-tags inspector or comprehensive IPTC, XMP, MakerNotes, or RAW workflow. Missing EXIF does not make a file a photo by extension alone, and strong generator evidence takes precedence over camera metadata unless you choose a manual Image Kind.

Photo probes are limited to 64 MiB of input. Malformed or over-budget probes remain retryable through metadata refresh. The updated photo-refresh workflow revisits previously imported eligible PNG/WebP records while preserving notes, collections, and manual classifications. Files with no supported metadata show “No supported metadata found”.

## Metadata Tab

Use Metadata to read the generation data Ambit parsed from the file. Everything in the tab is read-only: prompts, generator, model, parameters, and resources show what the image contains and cannot be edited in Ambit. The Positive Prompt section has Copy for the prompt, and search terms are highlighted in both prompts.

For images imported with InvokeAI source facts, Source identifies InvokeAI and can show the original image name, category, and origin. This section is available even when the image has no generation parameters. Unrecognized source categories are displayed as recorded instead of being guessed or discarded.

When InvokeAI recorded image-to-image inputs, the Metadata tab can also show:

- Source Images: images used to produce the current image, labelled by their roles such as Initial image, ControlNet input, or IP-Adapter input
- Used By: other Ambit images that used the current image as an input

Select an available entry to open it directly in the same viewer. This also works for InvokeAI assets hidden by the normal library View setting and does not change the current search, collection, or asset-visibility setting. A directly opened hidden asset has the normal viewer metadata and catalog actions, but Previous and Next navigation is unavailable because the asset is outside the current result list. References whose target has not been imported, and backlinks from Removed images, remain visible as disabled entries so the recorded provenance is not mistaken for a broken control.

Generation Parameters is an expandable section for generation parameters and source-compatible copies. It can show:

- Copy generation data in the section header for prompt and parameter text
- sampler, steps, CFG Scale, seed, VAE, Clip Skip, denoising, hires fix fields, and model hash when available, each with its name above a value box

Resource sections list parsed LoRAs, embeddings, hypernetworks, ControlNet, IP-Adapter, and supporting-model references. LoRAs, ControlNets, and IP-Adapters show their weight beside the name, to two decimals, when it was recorded. For ComfyUI, ControlNet and IP-Adapter weights come from the active nodes that apply them; a model applied at different weights in one workflow shows none.

## Comparing Two Images

The comparer's Differences sidebar shows the positive and negative prompts, then the model, sampler, seed, steps, CFG, size, and resources of both images, each with its name above one value box per image, followed by each file's SHA-256. In diff view, prompts and resources mark what changed: red for entries only the first image has, green for entries only the second has, and orange for a changed weight.

Internal Metadata opens a technical inspector with Parsed, Text, and, when workflow JSON exists, JSON views. This is useful when a generator embedded raw parameters or workflow data that is not shown elsewhere.

## Catalog Changes

The viewer has no Details tab and does not change metadata. Change collection membership from the library context menu or selection bar, and Image Kind from the context menu or selection bar. Notes and metadata edits saved by earlier versions stay in the catalog but cannot be changed in the viewer.

Image Kind offers Automatic, Generated, Photo, and Other. Automatic follows Ambit's conservative metadata detection. Manual choices are catalog-only and survive rescans; they do not rewrite the image file.

These changes update Ambit's catalog. They do not rewrite the original image file or change the original generator workflow.

## Workflow Tab

Use Workflow to inspect workflow JSON as a node graph when Ambit can parse one.

For images, opening Workflow replaces the image with a ComfyUI-style view of the workflow: nodes at their saved positions, colored links, groups, and widget values. Drag empty space to pan, scroll to zoom, and use Fit to View to frame the whole graph. You can rearrange the graph the way you would in ComfyUI:

- drag a node to move it, or drag its bottom-right corner to resize it
- click the dot in a node's title bar to collapse or expand it
- drag a group's title bar to move the group with everything inside it, or drag its bottom-right corner to resize it
- Ctrl+click or Shift+click to add nodes to the selection, Ctrl+drag on empty space to box-select (Shift+drag adds to the selection), and drag any selected node to move them together
- select widget text such as prompts, samplers, and model or LoRA names like any other text: drag to select, or click a field and press Ctrl+A, then Ctrl+C to copy. Values are read-only, and long prompts scroll inside their box. When zoomed out below 50%, widgets are drawn as part of the graph and can't be selected.

These layout changes last only while the viewer shows that image. They are never saved to the file, the workflow JSON, or the catalog. Reset Layout restores the saved positions, sizes, collapsed states, and groups. Double-click a subgraph node to open it; the breadcrumb returns to the parent graph. Workflows without saved node positions, such as API-format prompts, are arranged automatically. The graph stays when you hide the sidebar; theater mode shows the image again.

Bypassed nodes are purple and slightly faded, and muted nodes are faded further. Selecting a Use Everywhere node (Anything Everywhere, Anything Everywhere3, Anything Everywhere?, Prompts Everywhere, or Seed Everywhere) shows glowing links to the inputs it feeds. Recent versions of the extension save these connections in the workflow, and Ambit shows exactly those. For older workflows that don't save them, Ambit works them out the way the extension does: by matching type, by the title, input, and group patterns on Anything Everywhere?, by the positive and negative input names for Prompts Everywhere, and by seed inputs for Seed Everywhere. In that case, restrictions set from the node's context menu are not applied.

Widget names come from the workflow when it records them. Older workflows and nodes skipped in the saved prompt (bypassed or muted nodes, and nodes inside subgraphs) often save only the values. For those, Ambit uses a copy of the node definitions in the official Comfy Registry, about 21,000 custom node types, which ships with the app. It picks the version of each node whose widgets match the saved values. Core ComfyUI nodes, which are not in the Registry, and a few older custom node versions come from a smaller built-in list. Ambit never contacts the Registry while you use it. Widgets that no source matches are shown without names.

The Workflow tab can:

- lazy-load workflow data from file headers if the catalog does not already have it
- show the node count and whether the graph came from the workflow or the API prompt
- search nodes by title or type; matches stay highlighted in the graph, and choosing one centers it
- click a node in the graph to inspect its values and connections in the sidebar; following a connection moves the graph to that node
- switch between All Nodes and Selected Branch; Selected Branch dims nodes outside the saved output's dependency branch
- Copy workflow JSON
- Download workflow JSON to a file

Video Workflow keeps the node list in the sidebar, where you expand nodes to inspect simple input values.

Some images have no recorded workflow. Some workflow data is valid JSON but not a standard node graph, especially complex InvokeAI session data or unusual generator formats. In those cases Ambit can still offer a JSON preview, Copy, or Download when raw workflow data exists.

## Video Playback And Metadata

Videos open with playback controls and start muted. Space toggles playback; J and L seek backward or forward by ten seconds. Previous/Next navigates the current result set. Open in Default App remains available when the Windows media runtime cannot decode a cataloged file. Export Original copies the original video without transcoding. Image comparison, image versions, and slideshows are image-only.

Grid and timeline cards use static posters or a generic placeholder. A masked video does not create a player or play audio until revealed; re-enabling privacy protection stops playback and restores the gate.

Video Metadata can show ComfyUI prompts, generation mode, model, parameters, LoRAs, ControlNet, and IP-Adapter resources with evidence-source badges. Missing metadata is left unknown, and the video metadata is read-only.

Ambit reads embedded ComfyUI evidence and an exact sibling sidecar: for `clip.mp4`, use `clip.workflow.json` containing a `media` value of `clip.mp4` and a `workflow` value containing the workflow. Sidecars must be regular non-symlink UTF-8 JSON files no larger than 2 MiB. Valid matching sidecar evidence takes precedence over embedded evidence; conflicting values are retained rather than blended. Live Watch tracks sidecar changes for cataloged videos, and Refresh All Metadata can reconcile changes made while Ambit was closed.

## Image Versions

When an image has stack entries or related versions, the viewer shows a version strip near the bottom. Versions are ordered from the smaller base image toward larger versions. The active version is highlighted, larger or upscaled versions can show an upscale marker, and switching versions updates the preview and metadata.

## Optional Gemini Actions

If Gemini-powered intelligence features are enabled, the Metadata tab can show Creative Assistant actions:

- Prompt Analysis: opens an analysis result and, when available, an Applied Example prompt
- Variations: generates variation ideas with tabs for each result
- View last result: reopens the most recent AI result for the image

AI result views include copy actions such as Copy, Copy All, or Copy This Variation depending on the result type. These actions contact Gemini only when you run them. For setup, key storage, and network behavior, see [Settings And Privacy](settings-and-privacy.md).

## Troubleshooting Metadata

If metadata is missing or looks wrong:

1. Inspect Metadata and, for generated images, Internal Metadata to see what Ambit parsed.
2. Open Workflow to check whether workflow JSON exists or can be loaded from file headers.
3. Refresh metadata for the folder if the source file has newer metadata.

Metadata quality depends on what the generator embedded in the file.

## Next Step

For cleanup and repair workflows, continue with [Maintenance](maintenance.md).
