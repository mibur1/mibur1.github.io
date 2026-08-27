---
title: Multiverse Analysis
summary: Multiverse analysis runs every defensible version of an analysis rather than
  one, showing how robust a result is and which choices it hinges on.
color: '#0e6a5e'
color_dark: '#3aa899'
thumb: /static/img/multiverse.webp
description: Multiverse analysis runs every defensible version of an analysis rather than
  one, showing how robust a result is and which choices it hinges on.
---

<p class="badges">
<a class="badge" style="--c:#c2582b" href="https://doi.org/10.1162/IMAG.a.1122"><span class="badge__label">paper</span><span class="badge__value">Imaging Neuroscience</span></a>
<a class="badge" style="--c:#1f6091" href="https://github.com/mibur1/comet"><span class="badge__label">GitHub</span><span class="badge__value">mibur1/comet</span></a>
<a class="badge" style="--c:#0e6a5e" href="https://comet-toolbox.readthedocs.io/en/latest/"><span class="badge__label">docs</span><span class="badge__value">readthedocs</span></a>
</p>

Brain-behaviour analyses involve a long chain of decisions: how to clean the
data, which atlas to parcellate with, how to define connectivity, or how to model
the association. Each step has several defensible options, and published papers 
often reports exactly one path through that decision space.

[Multiverse analysis](https://doi.org/10.1177/1745691616658637) poses a different 
framework: instead of picking one pipeline, run all the defensible combinations and 
report the *distribution* of effects rather than a single point estimate. But implementing 
and running hundreds or thousands of pipelines in parallel is a lot of engineering, and simply
creating many results does not really tell you anything about what to infer from them.

To that avail, we developed the [**Comet Toolbox**](https://github.com/mibur1/comet), which is a Python 
package to help with these obstacles. It pairs a suite of **network neuroscience methods**, namely static
and dynamic functional connectivity, graph-theoretical measures, and various data 
processing related features with a **method-agnostic multiverse framework**. This multiverse
module wraps *any* analysis pipeline, so it isn't limited to the methods that
ship with the toolbox.


### An example

To be continued...