# Phase 1: Enhanced Content Extraction - Implementation Guide

## Overview

Phase 1 implements enhanced content extraction with lazy loading support. This addresses the limitation where modern websites with lazy-loaded content were not being fully captured.

## Architecture

### Configuration System

**Three-Tier Configuration Priority:**
1. **Site Overrides** (highest priority)
2. **Global Config** (user settings)
3. **Default Config** (fallback)

### Key Components

1. **Type Definitions** (`src/types/index.ts`)
   - `ContentExtractionConfig` - Main configuration interface
   - `ExtractionMetrics` - Performance metrics
   - `ExtractionLogEntry` - Logging structure

2. **Constants** (`src/lib/constants.ts`)
   - `STORAGE_KEYS.BROWSER.CONTENT_EXTRACTION_CONFIG` - Storage key
   - `DEFAULT_CONTENT_EXTRACTION_CONFIG` - Default values

3. **Content Extractor** (`src/lib/content-extractor.ts`)
   - Scroll strategies (none, instant, gradual, smart)
   - DOM mutation observer
   - Network idle detection
   - Pattern detection
   - Site-specific config matching

4. **Integration** (`src/contents/index.ts`)
   - Enhanced extraction pipeline
   - Logging and metrics
   - Debug functions

## Default Configuration

```typescript
{
  enabled: true,
  scrollStrategy: "smart",
  scrollDepth: 0.8,           // 80% of page
  scrollDelay: 300,           // 300ms between scrolls
  mutationObserverTimeout: 2000,  // Wait 2s for mutations
  networkIdleTimeout: 1000,      // Wait 1s for network idle
  maxWaitTime: 10000,             // 10s total timeout
  siteOverrides: {}
}
```

## Scroll Strategies

### `none`
- No scrolling
- Fastest extraction
- Use for static pages

### `instant`
- Instant scroll to target depth
- Good for simple lazy loading
- Fast but may miss content

### `gradual`
- Smooth scrolling with delays
- More reliable for lazy loading
- Balanced speed/accuracy

### `smart` (default)
- Intelligent scrolling with content detection
- Monitors content height changes
- Best for infinite scroll and dynamic content
- Slower but most comprehensive

## Detected Patterns

The system automatically detects:
- `infinite-scroll` - Infinite scroll containers
- `lazy-loaded-images` - Images with lazy loading
- `react-spa` - React-based single-page apps
- `modal-content` - Modal/dialog content
- `expandable-content` - Collapsible sections
- `intersection-observer-available` - Browser support

## Logging & Feedback

### Console Logging

All extraction steps are logged with `[Content Extraction]` prefix:
- Configuration used
- Scroll progress
- DOM mutations detected
- Network idle status
- Final metrics

### Extraction Logs

Logs are stored in `window.__ollamaExtractionLogs` array (last 50 entries):
- URL and site
- Metrics (duration, scroll steps, mutations)
- Detected patterns
- Configuration used
- Errors (if any)

### Debug Functions

Available in browser console:

```javascript
// Test transcript extraction
window.__testTranscript()

// Test content extraction
window.__testExtraction()

// Get extraction logs for feedback
window.__getExtractionLogs()
```

## Usage Flow

1. **Content script receives message** (`GET_PAGE_CONTENT`)
2. **Check permissions** (tab access enabled?)
3. **Check exclusions** (URL excluded?)
4. **Load configuration** (from storage or defaults)
5. **Determine effective config** (site override > global > default)
6. **Enhanced extraction** (if enabled):
   - Wait for page load
   - Execute scroll strategy
   - Monitor DOM mutations
   - Wait for network idle
   - Final scroll to bottom
7. **Readability parsing** (on loaded DOM)
8. **Transcript extraction** (if applicable)
9. **Combine and return** content

## Performance Considerations

### Timeouts
- `maxWaitTime`: Total timeout (default: 10s)
- `mutationObserverTimeout`: DOM change wait (default: 2s)
- `networkIdleTimeout`: Network idle wait (default: 1s)

### Fallback Behavior
- If enhanced extraction fails → falls back to basic Readability
- If timeout occurs → uses current DOM state
- Errors are logged but don't block extraction

## Testing

### Manual Testing

1. Open browser console on any page
2. Run extraction: `window.__testExtraction()`
3. Check logs: `window.__getExtractionLogs()`
4. Review metrics in console

### Site Testing Checklist

For each site, verify:
- [ ] Content loads below fold
- [ ] Lazy-loaded images appear
- [ ] Infinite scroll content captured
- [ ] Extraction time reasonable (<10s)
- [ ] Metrics logged correctly
- [ ] Patterns detected accurately

## Site-Specific Configuration (Phase 2 Preview)

In Phase 2, users will be able to configure per-site settings:

```typescript
siteOverrides: {
  "medium.com": {
    scrollDepth: 1.0,      // Full page
    scrollDelay: 500,      // Slower scrolling
    scrollStrategy: "gradual"
  },
  "twitter.com": {
    scrollDepth: 0.6,      // Partial scroll
    maxWaitTime: 15000,    // Longer timeout
    scrollStrategy: "smart"
  }
}
```

## Feedback Collection

When users report issues, collect:
1. URL of problematic site
2. Extraction logs: `window.__getExtractionLogs()`
3. Console errors (if any)
4. Expected vs actual content length

## Known Limitations

1. **Cannot interact with modals** - Content in modals may not be captured
2. **Client-side routing** - SPAs may need page interaction first
3. **Protected content** - Sites blocking scraping won't work
4. **Performance** - Some sites may take longer than timeout

## Next Steps (Phase 2)

1. **UI Component** - Options page tab for configuration
2. **Site Override Management** - Add/edit/delete site configs
3. **Preset Configurations** - Fast/Balanced/Thorough presets
4. **Export/Import** - Share configurations
5. **Auto-suggestions** - Recommend configs based on detected patterns

## File Structure

```
src/
├── types/
│   └── index.ts                    # Type definitions
├── lib/
│   ├── constants.ts                # Default config & storage keys
│   └── content-extractor.ts        # Extraction logic
└── contents/
    └── index.ts                    # Integration & message handler
```

## Configuration Schema

```typescript
interface ContentExtractionConfig {
  enabled: boolean
  scrollStrategy: "none" | "gradual" | "instant" | "smart"
  scrollDepth: number              // 0.0 - 1.0
  scrollDelay: number              // milliseconds
  mutationObserverTimeout: number  // milliseconds
  networkIdleTimeout: number       // milliseconds
  maxWaitTime: number              // milliseconds
  siteOverrides: Record<string, Partial<ContentExtractionConfig>>
}
```

## Troubleshooting

### Extraction too slow
- Reduce `scrollDepth`
- Reduce `mutationObserverTimeout`
- Use `gradual` instead of `smart`

### Missing content
- Increase `scrollDepth` to 1.0
- Increase `maxWaitTime`
- Use `smart` strategy
- Check for site-specific patterns

### Errors in logs
- Check console for detailed errors
- Verify site isn't blocking scripts
- Try disabling and re-enabling feature

