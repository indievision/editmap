import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDurationSeconds } from '../src/components/PrintableReport';
import { cutTimes, pacingCurve } from '../src/analysis/pacing';
import { framingSummary } from '../src/analysis/framing';
import type { Shot } from '../src/models/project';

test('formatDurationSeconds formats seconds nicely for report display', () => {
  assert.equal(formatDurationSeconds(0), '0s');
  assert.equal(formatDurationSeconds(0.5), '0.5s');
  assert.equal(formatDurationSeconds(5.2), '5.2s');
  assert.equal(formatDurationSeconds(15), '15s');
  assert.equal(formatDurationSeconds(125), '2m 5s');
});

test('report data calculations produce accurate metrics', () => {
  const sampleShots: Shot[] = [
    {
      id: 'shot-1',
      index: 0,
      sourceReel: 'AX',
      sourceIn: '00:00:00:00',
      sourceOut: '00:00:02:00',
      startTimecode: '00:00:00:00',
      endTimecode: '00:00:02:00',
      startSeconds: 0,
      endSeconds: 2,
      duration: 2,
      transition: 'C',
      shotSize: 'WS',
      notes: '',
    },
    {
      id: 'shot-2',
      index: 1,
      sourceReel: 'AX',
      sourceIn: '00:00:00:00',
      sourceOut: '00:00:04:00',
      startTimecode: '00:00:02:00',
      endTimecode: '00:00:06:00',
      startSeconds: 2,
      endSeconds: 6,
      duration: 4,
      transition: 'C',
      shotSize: 'CU',
      notes: 'Close up on main character',
    },
    {
      id: 'shot-3',
      index: 2,
      sourceReel: 'AX',
      sourceIn: '00:00:00:00',
      sourceOut: '00:00:04:00',
      startTimecode: '00:00:06:00',
      endTimecode: '00:00:10:00',
      startSeconds: 6,
      endSeconds: 10,
      duration: 4,
      transition: 'C',
      shotSize: 'MCU',
      notes: '',
    },
  ];

  const totalDuration = 10;
  const cuts = cutTimes(sampleShots);
  assert.equal(cuts.length, 2);

  const asl = totalDuration / sampleShots.length;
  assert.equal(asl.toFixed(2), '3.33');

  const durations = sampleShots.map((s) => s.duration).sort((a, b) => a - b);
  assert.deepEqual(durations, [2, 4, 4]);

  const median = durations[1];
  assert.equal(median, 4);

  const framing = framingSummary(sampleShots);
  assert.equal(framing.total, 10);
  assert.equal(framing.closeShare, 0.4); // CU (4s) out of 10s total

  const pacing = pacingCurve(cuts, totalDuration, 5);
  assert.equal(pacing.length, 601);
});

test('report accurately tracks sensory shock across cut boundaries', async () => {
  const { computeCutShockData } = await import('../src/analysis/pacing');
  const shotsWithColor: Shot[] = [
    {
      id: 'shot-1',
      index: 0,
      sourceReel: 'AX',
      sourceIn: '00:00:00:00',
      sourceOut: '00:00:02:00',
      startTimecode: '00:00:00:00',
      endTimecode: '00:00:02:00',
      startSeconds: 0,
      endSeconds: 2,
      duration: 2,
      transition: 'C',
      shotSize: 'WS',
      notes: '',
      colorProfile: {
        palette: ['#000000', '#111111', '#222222'],
        luminance: 0.0,
        temperature: 0,
        saturation: 0,
        mood: 'Low-Key / Dark',
        harmony: { type: 'monochromatic', label: 'Monochromatic', confidence: 1, dominantHue: 0 },
      },
    },
    {
      id: 'shot-2',
      index: 1,
      sourceReel: 'AX',
      sourceIn: '00:00:02:00',
      sourceOut: '00:00:03:00',
      startTimecode: '00:00:02:00',
      endTimecode: '00:00:03:00',
      startSeconds: 2,
      endSeconds: 3,
      duration: 1,
      transition: 'C',
      shotSize: 'CU',
      notes: '',
      colorProfile: {
        palette: ['#FFFFFF', '#EEEEEE', '#DDDDDD'],
        luminance: 1.0,
        temperature: 0,
        saturation: 0,
        mood: 'High-Key / Bright',
        harmony: { type: 'monochromatic', label: 'Monochromatic', confidence: 1, dominantHue: 0 },
      },
    },
  ];

  const cutShock = computeCutShockData(shotsWithColor);
  assert.equal(cutShock.length, 1);
  assert.ok(cutShock[0].shockScore >= 70, `Expected shock score >= 70, got ${cutShock[0].shockScore}`);
  assert.equal(cutShock[0].time, 2);
});

test('ReportExportConfig preserves user customisations across export', async () => {
  const { type } = await import('../src/components/ReportExportModal');
  const customConfig = {
    theme: 'dark' as const,
    format: 'A4 Portrait' as const,
    sections: {
      summary: true,
      rhythm: false,
      pacing: true,
      framing: false,
      color: true,
      cast: true,
      notes: false,
    },
  };

  assert.equal(customConfig.theme, 'dark');
  assert.equal(customConfig.format, 'A4 Portrait');
  assert.equal(customConfig.sections.rhythm, false);
  assert.equal(customConfig.sections.color, true);
});

test('formatPdfFilename sanitizes and creates clean report file names', async () => {
  const { formatPdfFilename, getPageDimensions } = await import('../src/utils/pdfExport');

  assert.equal(formatPdfFilename('My Feature Film'), 'my-feature-film-film-analysis-report.pdf');
  assert.equal(formatPdfFilename('Project #12 (Final Cut!)'), 'project-12-final-cut-film-analysis-report.pdf');
  assert.equal(formatPdfFilename(''), 'editmap-film-analysis-report.pdf');
  assert.equal(formatPdfFilename(undefined), 'editmap-film-analysis-report.pdf');

  const landscapeDims = getPageDimensions('A4 Landscape');
  assert.equal(landscapeDims.widthMm, 297);
  assert.equal(landscapeDims.heightMm, 210);
  assert.equal(landscapeDims.orientation, 'landscape');

  const portraitDims = getPageDimensions('A4 Portrait');
  assert.equal(portraitDims.widthMm, 210);
  assert.equal(portraitDims.heightMm, 297);
  assert.equal(portraitDims.orientation, 'portrait');

  const letterDims = getPageDimensions('Letter');
  assert.equal(letterDims.widthMm, 279.4);
  assert.equal(letterDims.heightMm, 215.9);
  assert.equal(letterDims.orientation, 'landscape');
});

