# Third-Party Notices

Original FractureLab application code and documentation are licensed under the
MIT License in [LICENSE](LICENSE), copyright (c) 2026 FractureLab contributors.
That license does not replace the licenses of the components below.

Versions and SPDX identifiers were checked against the **installed packages'
`package.json` files** and the repository lockfile on **2026-09-06**, rather than
inferred from library names. Copyright and permission notices were checked against
the packages' license files. Rapier's installed compatibility package declares
Apache-2.0 but contains no standalone LICENSE/NOTICE file; its license text and
Dimforge attribution below were checked against the
[upstream rapier.js LICENSE](https://github.com/dimforge/rapier.js/blob/master/LICENSE).
Links in this document are references, not application runtime requests.

## Runtime Components

| Package | Resolved Version | License | Use / Upstream |
| --- | --- | --- | --- |
| `react` | 19.2.8 | MIT | Editor UI; https://github.com/facebook/react |
| `react-dom` | 19.2.8 | MIT | DOM renderer; https://github.com/facebook/react |
| `scheduler` | 0.27.0 | MIT | React DOM runtime dependency; https://github.com/facebook/react |
| `three` | 0.174.0 (r174) | MIT | WebGL rendering and addons; https://github.com/mrdoob/three.js |
| `@dimforge/rapier3d-compat` | 0.19.3 | Apache-2.0 | Local rigid-body solver with inlined WASM; https://github.com/dimforge/rapier.js |
| `lucide-react` | 0.468.0 | ISC | SVG interface icons; https://github.com/lucide-icons/lucide |
| `webm-muxer` | 5.1.4 | MIT | Local WebM container writing; https://github.com/Vanilagy/webm-muxer |

Three's `OrbitControls`, `TransformControls`, and `RoomEnvironment` are imported
from the installed Three addons, not fetched remotely. The studio environment
derives from **MIT-licensed Three RoomEnvironment**, with an application-added
softbox and local PMREM generation. It is not an original HDR photograph or a
downloaded HDRI. The addon retains its upstream source reference to Google's
model-viewer `EnvironmentScene.ts`.

`webm-muxer` 5.1.4 is pinned by `package-lock.json` for `npm ci`. The application
adapter in `src/video.js` corrects the generated Segment/Info/Duration float to
include the final frame's presentation interval, without shifting encoded data
or cue offsets. It does not modify the dependency's source. WebCodecs VP9 encoding
is supplied by the browser, not a bundled remote encoding service.

## Development Tools

| Package | Resolved Version | License | Scope |
| --- | --- | --- | --- |
| `vite` | 6.4.3 | MIT | Development server and build tool; https://github.com/vitejs/vite |
| `@vitejs/plugin-react` | 4.7.0 | MIT | React compilation / development refresh; https://github.com/vitejs/vite-plugin-react |
| `@playwright/test` | 1.63.0 | Apache-2.0 | Browser workflow and performance automation |
| `playwright`, `playwright-core` | 1.63.0 each | Apache-2.0 | Transitive automation runtime; https://github.com/microsoft/playwright |
| `@types/dom-webcodecs` | 0.1.19 | MIT | Type declarations installed by webm-muxer; no browser runtime code |
| `@types/wicg-file-system-access` | 2020.9.8 | MIT | Type declarations installed by webm-muxer; no browser runtime code |

Build/test tools and downloaded Playwright browsers are not shipped as application
runtime code in the production bundle. Their own transitive dependencies retain
their package licenses. In particular, `node_modules/vite/LICENSE.md` contains
additional bundled-tool notices under Apache-2.0, BSD-2-Clause, CC0-1.0, ISC and MIT;
Vite's MIT entry above does not relicense those components. Retain the complete
package license/notice files if redistributing development tools or `node_modules`.
The downloaded Chromium distribution carries its own third-party notices.

## Asset Provenance

- Fonts: system/local font stacks only. Inter is used only if locally available, with Segoe UI/Arial/sans-serif fallbacks; monospace uses system fallbacks. No font file or web-font service is distributed or requested.
- Material textures: application-generated grain, aggregate and metal textures; no downloaded texture pack.
- Models and debris: generated rectangular envelopes and seeded full-volume partitions; no third-party mesh assets or canned destruction recordings.
- Studio lighting: locally generated Three RoomEnvironment-derived environment, not a remote asset.
- Interface and instruments: Lucide SVG icons plus application-generated brand, material swatches, grid, axes, labels and diagnostic overlays.
- Audio: none. No music, sound effects, audio instruments, samples, or audio track in exported video.

Include this notice and the application LICENSE with redistributed application
bundles. The current Vite build does not automatically copy these root documents
into `dist/`; they must accompany a distribution separately. Preserve relevant
upstream copyright/permission notices and Apache license terms.

## MIT Notices

The following copyright notices apply to their respective components. The full
MIT permission and disclaimer text below accompanies each notice:

```text
React, React DOM, Scheduler:
Copyright (c) Meta Platforms, Inc. and affiliates.

Three.js and its included addons:
Copyright (c) 2010-2025 three.js authors

webm-muxer:
Copyright (c) 2022 Vanilagy

Vite core:
Copyright (c) 2019-present, VoidZero Inc. and Vite contributors

@vitejs/plugin-react:
Copyright (c) 2019-present, Yuxi (Evan) You and Vite contributors

@types/dom-webcodecs and @types/wicg-file-system-access:
Copyright (c) Microsoft Corporation.

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Lucide ISC Notice

From `node_modules/lucide-react/LICENSE`, including its Feather attribution:

```text
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

## Playwright Attribution

From the installed Playwright NOTICE:

```text
Playwright
Copyright (c) Microsoft Corporation

This software contains code derived from the Puppeteer project (https://github.com/puppeteer/puppeteer),
available under the Apache 2.0 license (https://github.com/puppeteer/puppeteer/blob/master/LICENSE).
```

The installed Playwright LICENSE additionally states:

```text
Portions Copyright (c) Microsoft Corporation.
Portions Copyright 2017 Google Inc.
```

Rapier and Playwright are licensed under the Apache License, Version 2.0,
reproduced below. The appendix's Dimforge attribution is from Rapier's upstream
license; it does not apply to the original FractureLab application.

## Apache License 2.0

```text
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright 2020 Dimforge EURL

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```
