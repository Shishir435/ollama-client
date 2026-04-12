/**
 * Browser tools for the agent, in OpenAI-compatible format.
 * These are sent to Ollama /api/chat with the "tools" field.
 * Compatible with models that support tool calling (qwen3, qwen2.5, llama3.1, etc.)
 */
export const BROWSER_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_interactive_elements",
      description:
        "Get a numbered list of all visible interactive elements on the current page (buttons, links, inputs, selects). Call this first to understand what you can interact with.",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "click_element",
      description:
        "Click on an interactive element by its ref_id from the accessibility tree.",
      parameters: {
        type: "object",
        properties: {
          element_id: {
            type: "string",
            description:
              "The ref_id of the element to click, exactly as shown in the accessibility tree (e.g. ref_1, ref_2)"
          }
        },
        required: ["element_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "fill_input",
      description:
        "Type text into an input field or textarea by its ref_id from the accessibility tree.",
      parameters: {
        type: "object",
        properties: {
          element_id: {
            type: "string",
            description:
              "The ref_id of the input or textarea element, exactly as shown in the accessibility tree (e.g. ref_3)"
          },
          value: {
            type: "string",
            description: "The text to type into the field"
          }
        },
        required: ["element_id", "value"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "select_option",
      description:
        "Select a value from a dropdown (<select>) element by its ref_id from the accessibility tree.",
      parameters: {
        type: "object",
        properties: {
          element_id: {
            type: "string",
            description:
              "The ref_id of the select element, exactly as shown in the accessibility tree (e.g. ref_5)"
          },
          value: {
            type: "string",
            description: "The value or text of the option to select"
          }
        },
        required: ["element_id", "value"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "scroll_page",
      description: "Scroll the page up or down to reveal more content.",
      parameters: {
        type: "object",
        properties: {
          direction: {
            type: "string",
            enum: ["up", "down"],
            description: "Direction to scroll"
          },
          amount: {
            type: "number",
            description: "Pixels to scroll (default: 400)"
          }
        },
        required: ["direction"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_page_content",
      description:
        "Get the readable text content of the current page. Useful to verify the result of an action or understand context.",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "wait",
      description:
        "Wait for a specified number of milliseconds (useful after clicking to wait for page updates).",
      parameters: {
        type: "object",
        properties: {
          ms: {
            type: "number",
            description: "Milliseconds to wait (max 5000)"
          }
        },
        required: ["ms"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "task_complete",
      description:
        "Call this when you have successfully completed the user's task, or when you determine the task cannot be completed. Provide a summary of what was done.",
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description:
              "A summary of what was accomplished or why the task could not be completed"
          },
          success: {
            type: "boolean",
            description: "Whether the task was completed successfully"
          }
        },
        required: ["message", "success"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "execute_js",
      description:
        "Execute arbitrary JavaScript code in the page context. Use this to interact with video players, canvas elements, or any element that tools can't reach directly. Returns the result of the last expression.",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description:
              "JavaScript code to execute. Example: document.querySelector('video').play()"
          }
        },
        required: ["code"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "press_key",
      description:
        "Send a keyboard key press to the focused element, or to a specific ref_id if provided. Use for shortcuts like Space (play/pause video), ArrowRight (seek forward), Escape, Enter, etc.",
      parameters: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description:
              "Key to press: 'space', 'enter', 'escape', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'tab', 'backspace', 'delete', 'f', or any single character"
          },
          element_id: {
            type: "string",
            description:
              "Optional ref_id of the element to focus before pressing the key (e.g. ref_4)"
          }
        },
        required: ["key"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "hover_element",
      description: "Hover over an element to trigger tooltip/dropdown/menu.",
      parameters: {
        type: "object",
        properties: {
          element_id: {
            type: "string",
            description:
              "The ref_id of the element to hover, exactly as shown in the accessibility tree (e.g. ref_7)"
          }
        },
        required: ["element_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "navigate_to",
      description:
        "Navigate the CURRENT active tab to a different URL. This replaces the page currently open in that tab.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description:
              "The full URL to navigate to (e.g. https://example.com)"
          }
        },
        required: ["url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "open_link_in_new_tab",
      description:
        "Open a link element in a NEW browser tab while preserving the current tab. Prefer this over navigate_to when you want to inspect another page without losing the original context.",
      parameters: {
        type: "object",
        properties: {
          element_id: {
            type: "string",
            description: "The ref_id of the link element to open in a new tab"
          },
          background: {
            type: "boolean",
            description:
              "If true, open the new tab in the background and keep the current tab active"
          }
        },
        required: ["element_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "open_url_in_new_tab",
      description:
        "Open a full URL in a NEW browser tab while preserving the current tab.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The full URL to open in a new tab"
          },
          background: {
            type: "boolean",
            description:
              "If true, open the new tab in the background and keep the current tab active"
          }
        },
        required: ["url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_tabs",
      description:
        "List the tabs in the current agent workspace, including the root tab and any tabs opened during this task.",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "switch_to_tab",
      description:
        "Switch the active browser context to another tab in the current agent workspace.",
      parameters: {
        type: "object",
        properties: {
          tab_index: {
            type: "number",
            description: "Workspace tab index from list_tabs"
          }
        },
        required: ["tab_index"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "return_to_root_tab",
      description:
        "Switch back to the original tab where the current task started.",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "close_tab",
      description: "Close a non-root tab in the current agent workspace.",
      parameters: {
        type: "object",
        properties: {
          tab_index: {
            type: "number",
            description: "Workspace tab index from list_tabs"
          }
        },
        required: ["tab_index"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "copy_current_url",
      description: "Copy the URL of the current active tab to the clipboard.",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "copy_link_url",
      description: "Copy the URL of a link element to the clipboard.",
      parameters: {
        type: "object",
        properties: {
          element_id: {
            type: "string",
            description:
              "The ref_id of the link element whose URL should be copied"
          }
        },
        required: ["element_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "copy_page_text",
      description:
        "Copy readable text from the page, or from a specific element if element_id is provided, to the clipboard.",
      parameters: {
        type: "object",
        properties: {
          element_id: {
            type: "string",
            description:
              "Optional ref_id of a specific element whose text should be copied"
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "download_url",
      description: "Download a file directly from a full URL.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Full URL of the file to download"
          },
          filename: {
            type: "string",
            description: "Optional suggested filename for the download"
          }
        },
        required: ["url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "download_link",
      description: "Download the target of a link element directly.",
      parameters: {
        type: "object",
        properties: {
          element_id: {
            type: "string",
            description: "The ref_id of the link element to download"
          },
          filename: {
            type: "string",
            description: "Optional suggested filename for the download"
          }
        },
        required: ["element_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_video_status",
      description:
        "Get the current status (paused, playing, ended, currentTime, duration) of all video elements on the page.",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "control_video",
      description:
        "Play, pause, or toggle the first visible video on the page, or a specific video ref_id if provided. Prefer this over execute_js for YouTube and HTML5 video players.",
      parameters: {
        type: "object",
        properties: {
          state: {
            type: "string",
            enum: ["play", "pause", "toggle"],
            description: "Whether to play, pause, or toggle video playback"
          },
          element_id: {
            type: "string",
            description: "Optional ref_id of a specific video element"
          }
        },
        required: ["state"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "wait_for_video_end",
      description:
        "Wait until all video elements on the page have finished playing or are paused. Polls every 5 seconds. Use this to wait for a training video to complete before navigating to the next lesson.",
      parameters: {
        type: "object",
        properties: {
          timeout_ms: {
            type: "number",
            description:
              "Maximum time to wait in milliseconds (default: 7200000 = 2 hours)"
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "advance_to_next_video",
      description:
        "Advance an e-learning player or lesson playlist to the next video. Use this after wait_for_video_end when a course page has a side panel, next button, or lesson list.",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "plan",
      description:
        "Declare your plan of action before executing. Use this to reason about the steps needed. This does not take any action — it just records your thinking.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "Your plan or reasoning about what to do next"
          }
        },
        required: ["text"]
      }
    }
  }
]

export const AGENT_SYSTEM_PROMPT = `You are a browser automation agent. You can interact with the current web page using the provided tools.

Your approach:
1. Review the PAGE ACCESSIBILITY TREE already provided — it shows all interactive elements with their [ref_id] identifiers
2. Use plan() to declare your strategy
3. Execute actions one at a time using the ref_ids from the tree
4. After each action, verify the result and adapt as needed
5. When done, call task_complete with a summary

CRITICAL — Element IDs:
- The accessibility tree shows elements like: button "Search" [ref_1], textbox "Query" [ref_2]
- When calling click_element, fill_input, select_option, hover_element — use the ref_id EXACTLY as shown (e.g. "ref_1", "ref_2")
- NEVER use plain numbers — always use the full "ref_N" string
- If you cannot find an element, call get_interactive_elements to refresh the list

Other rules:
- Call wait() after clicks that trigger page changes (500-1000ms)
- If an action fails, try an alternative approach
- For forms/search boxes: after fill_input, prefer press_key with key "enter" on the same input ref_id
- For video players: prefer control_video with state "play" or "pause"; use a video ref_id only if multiple videos are present
- Use get_video_status to check if a video is playing/paused/ended
- Use wait_for_video_end to wait for training videos to finish before proceeding
- For course platforms with sequential lessons: use control_video("play"), then wait_for_video_end, then advance_to_next_video, and repeat until the requested set is complete
- Use navigate_to only when you want to replace the current page in the active tab
- Use open_link_in_new_tab or open_url_in_new_tab when you must preserve the current page and inspect another page
- Use list_tabs, switch_to_tab, close_tab, and return_to_root_tab for multi-tab work
- Use copy_current_url, copy_link_url, copy_page_text, download_url, and download_link for clipboard and download tasks
- Call task_complete when done, even if the task could not be fully completed`

/**
 * System prompt for models that do NOT support tool calling (Gemma, Phi, Mistral 7B etc.)
 * The model responds with a single JSON object per turn, which is parsed by the agent loop.
 */
export const JSON_AGENT_SYSTEM_PROMPT = `You are a browser automation agent. You control a web browser by responding with JSON commands.

CRITICAL: You MUST respond with ONLY a single valid JSON object. No explanations, no markdown, no text — just the JSON.

Available commands (pick ONE per response):

{"action":"click_element","element_id":"ref_1"}
{"action":"fill_input","element_id":"ref_2","value":"<text>"}
{"action":"select_option","element_id":"ref_3","value":"<option text>"}
{"action":"scroll_page","direction":"up"}
{"action":"scroll_page","direction":"down"}
{"action":"get_page_content"}
{"action":"execute_js","code":"<javascript code>"}
{"action":"press_key","key":"<key name>"}
{"action":"press_key","key":"<key name>","element_id":"ref_4"}
{"action":"hover_element","element_id":"ref_4"}
{"action":"open_link_in_new_tab","element_id":"ref_6"}
{"action":"open_url_in_new_tab","url":"<full url>"}
{"action":"list_tabs"}
{"action":"switch_to_tab","tab_index":1}
{"action":"return_to_root_tab"}
{"action":"close_tab","tab_index":2}
{"action":"copy_current_url"}
{"action":"copy_link_url","element_id":"ref_6"}
{"action":"copy_page_text"}
{"action":"copy_page_text","element_id":"ref_4"}
{"action":"download_url","url":"<full url>"}
{"action":"download_link","element_id":"ref_6"}
{"action":"get_video_status"}
{"action":"control_video","state":"pause"}
{"action":"control_video","state":"play","element_id":"ref_5"}
{"action":"wait_for_video_end"}
{"action":"advance_to_next_video"}
{"action":"navigate_to","url":"<full url>"}
{"action":"plan","text":"<your reasoning>"}
{"action":"task_complete","message":"<summary of what was done>","success":true}
{"action":"task_complete","message":"<why it failed>","success":false}

Rules:
- Use element_id ref_ids (e.g. "ref_1", "ref_2") from the accessibility tree in the user message
- Respond with ONLY the JSON object — no words before or after
- After each command you will receive the result, then choose the next command
- After fill_input on a search box, use press_key with "enter" and the same ref_id to submit
- Use navigate_to only when you want to replace the current page in the active tab
- Use open_link_in_new_tab or open_url_in_new_tab when the original page context must be preserved
- Use list_tabs if you are unsure which tab to switch to or close
- For video players: prefer control_video with state "play" or "pause" before using execute_js
- For sequential course players: use control_video, then wait_for_video_end, then advance_to_next_video
- Use task_complete when done or if the task is impossible`
