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
often report exactly one path through that decision space.

[Multiverse analysis](https://doi.org/10.1177/1745691616658637) poses a different 
framework: instead of picking one pipeline, run all the defensible combinations and 
report the *distribution of effects* rather than a single point estimate. But implementing 
and running hundreds or thousands of pipelines in parallel is a lot of engineering, and simply
creating many results does not really tell you anything about what to infer from them.

We developed the [Comet Toolbox](https://github.com/mibur1/comet), which is a Python 
package to help with exactly these obstacles. It pairs a suite of *network neuroscience methods*, 
namely static and dynamic functional connectivity, graph-theoretical measures, and various data 
processing related features with a *method-agnostic multiverse framework*. This multiverse
module wraps *any* analysis pipeline, so it isn't limited to the methods that ship with the toolbox.


### An example

[Popp et al. (2026)](https://www.biorxiv.org/content/10.64898/2026.01.19.700296v1) recently published
a preprint which reports (among other things) that higher neuroticism trait scores go with 
*greater heterogeneity* in movie-evoked brain activity. We can replicate and stress-test this 
finding in a multiverse analysis consisting of *1920 defensible analysis pipelines*:

<figure class="figure--aside" markdown="1">
<img src="/static/img/multiverse.webp"
     alt="Multiverse plot"
     loading="lazy" decoding="async">
<figcaption>
<b>Multiverse plot.</b>
The multiverse plot summarises the results of all 1920 analysis pipelines on a single
axis (the whole-brain IS-RSA effect). The upper plot shows the distribtuion of the effects, 
with the black dot marking the result achieved with the analytical decisions taken by 
Popp et al. (2026). In the lower plot, each block is one analytical decision, shaded to 
show where the pipelines using each option land, with the mean shift from the reference 
option on the right.
</figcaption>
</figure>

In this figure, it becomes easily visible that the effect replicates reasonably well, and that the published 
result sits in the middle of the distribution rather than out at a tail. Across *all* 1920 universes the effect
stays positive, and it is significant in the majority of them.

One interesting part is which decisions actually mattered. For example, how the sibling
pairs are split has (expectedly) a pretty large influence on the effect. Other decisions like the choice of 
the brain atlas has a smaller influence, but still showing a trend of coarser parcellations tending to perform better.

This view can further be extended through various ways, such as using the observed patterns to form better theories
or through integration techniques aiming to integrate the multiverse results to a single answer. Many of these extensions
are active areas of research.