import { useState, useMemo } from 'react';

interface CodeBlock {
  language: string;
  code: string;
  filename: string;
}

interface MessageContentProps {
  content: string;
  isStreaming?: boolean;
}

// Detect filename from code content
function detectFilename(code: string, language: string, index: number): string {
  const lines = code.split('\n');
  const firstLine = lines[0];
  
  // Check for explicit filename in comment
  const commentPatterns = [
    /\/\/\s*(?:file(?:name)?:?\s*)?(\S+\.\w+)/i,  // // filename.tsx or // file: name.tsx
    /^#\s*(?:file(?:name)?:?\s*)?(\S+\.\w+)/i,    // # filename.py
    /<!--\s*(\S+\.\w+)\s*-->/,                     // <!-- filename.html -->
    /\/\*\s*(\S+\.\w+)\s*\*\//,                   // /* filename.css */
  ];
  
  for (const pattern of commentPatterns) {
    const match = firstLine.match(pattern);
    if (match) return match[1];
  }

  // Check if code contains JSX (React component)
  const hasJSX = /<[A-Z][a-zA-Z]*|<\/|<[a-z]+\s|return\s*\([\s\S]*</.test(code);
  const hasReactImport = /import.*React|from\s+['"]react['"]/.test(code);
  const isReactComponent = hasJSX || hasReactImport;

  // Try to detect component/function/class name from code
  const patterns = [
    // React components: const Button = or function Button or export default Button
    /(?:export\s+(?:default\s+)?)?(?:const|let|var|function)\s+([A-Z][a-zA-Z0-9]*)/,
    // Class declarations
    /class\s+([A-Z][a-zA-Z0-9]*)/,
    // Python class/function
    /(?:class|def)\s+([A-Za-z_][A-Za-z0-9_]*)/,
    // Export default function/const
    /export\s+default\s+(?:function\s+)?([A-Z][a-zA-Z0-9]*)/,
  ];

  for (const pattern of patterns) {
    const match = code.match(pattern);
    if (match && match[1]) {
      const name = match[1];
      // Use .tsx for React components with JSX, otherwise use language extension
      let ext = getExtension(language);
      if (isReactComponent && (language === 'typescript' || language === 'tsx' || language === 'ts')) {
        ext = 'tsx';
      } else if (isReactComponent && (language === 'javascript' || language === 'jsx' || language === 'js')) {
        ext = 'jsx';
      }
      return `${name}.${ext}`;
    }
  }

  // Check for interface/type names (for TypeScript types files)
  const interfaceMatch = code.match(/(?:interface|type)\s+([A-Z][a-zA-Z0-9]*)/);
  if (interfaceMatch) {
    // If it's just types/interfaces without JSX, use .ts
    const ext = isReactComponent ? 'tsx' : 'ts';
    return `${interfaceMatch[1]}.${ext}`;
  }

  // Fallback: generate based on language and index
  const ext = getExtension(language);
  return index === 0 ? `code.${ext}` : `code-${index + 1}.${ext}`;
}

function getExtension(language: string): string {
  const extensions: Record<string, string> = {
    typescript: 'ts',
    tsx: 'tsx',
    javascript: 'js',
    jsx: 'jsx',
    python: 'py',
    css: 'css',
    scss: 'scss',
    html: 'html',
    json: 'json',
    bash: 'sh',
    shell: 'sh',
    yaml: 'yaml',
    yml: 'yml',
    markdown: 'md',
    md: 'md',
    sql: 'sql',
    graphql: 'graphql',
    rust: 'rs',
    go: 'go',
    java: 'java',
    kotlin: 'kt',
    swift: 'swift',
    ruby: 'rb',
    php: 'php',
    csharp: 'cs',
    cpp: 'cpp',
    c: 'c',
  };
  return extensions[language.toLowerCase()] || language || 'txt';
}

// Parse code blocks from markdown-style content
function parseContent(content: string): (string | CodeBlock)[] {
  const parts: (string | CodeBlock)[] = [];
  const codeBlockRegex = /```(\w+)?\s*\n?([\s\S]*?)```/g;
  
  let lastIndex = 0;
  let match;
  let codeIndex = 0;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }

    const language = match[1] || 'text';
    const code = match[2].trim();
    const filename = detectFilename(code, language, codeIndex);

    parts.push({ language, code, filename });
    lastIndex = match.index + match[0].length;
    codeIndex++;
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return parts;
}

function CodeBlockComponent({ block, defaultExpanded = true }: { 
  block: CodeBlock; 
  defaultExpanded?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(defaultExpanded);

  const lineCount = block.code.split('\n').length;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(block.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([block.code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = block.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`code-block ${expanded ? 'expanded' : 'collapsed'}`}>
      <div className="code-block-header" onClick={() => setExpanded(!expanded)}>
        <button className="expand-btn" title={expanded ? 'Collapse' : 'Expand'}>
          {expanded ? '▼' : '▶'}
        </button>
        <span className="code-language">{block.language}</span>
        <span className="code-filename">{block.filename}</span>
        <span className="code-lines">{lineCount} lines</span>
        <div className="code-actions" onClick={(e) => e.stopPropagation()}>
          <button onClick={handleCopy} className="code-action-btn" title="Copy code">
            {copied ? '✓' : '📋'}
          </button>
          <button onClick={handleDownload} className="code-action-btn" title="Download file">
            ⬇️
          </button>
        </div>
      </div>
      {expanded && (
        <pre className="code-content">
          <code>{block.code}</code>
        </pre>
      )}
    </div>
  );
}

function DownloadAllButton({ codeBlocks }: { codeBlocks: CodeBlock[] }) {
  const handleDownloadAll = async () => {
    // Dynamic import JSZip only when needed
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    // Track filenames to avoid duplicates
    const usedNames = new Map<string, number>();
    
    codeBlocks.forEach((block) => {
      let filename = block.filename;
      
      // Handle duplicate filenames
      if (usedNames.has(filename)) {
        const count = usedNames.get(filename)! + 1;
        usedNames.set(filename, count);
        const ext = filename.lastIndexOf('.');
        filename = ext > 0 
          ? `${filename.slice(0, ext)}-${count}${filename.slice(ext)}`
          : `${filename}-${count}`;
      } else {
        usedNames.set(filename, 1);
      }
      
      zip.file(filename, block.code);
    });

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'code-files.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <button onClick={handleDownloadAll} className="download-all-btn">
      📦 Download All ({codeBlocks.length} files)
    </button>
  );
}

export function MessageContent({ content, isStreaming }: MessageContentProps) {
  const parts = useMemo(() => parseContent(content), [content]);
  
  const codeBlocks = useMemo(() => 
    parts.filter((part): part is CodeBlock => typeof part !== 'string'),
    [parts]
  );

  return (
    <div className="message-content-parsed">
      {parts.map((part, index) => {
        if (typeof part === 'string') {
          return (
            <span key={index} className="text-content">
              {part.split('\n').map((line, i) => (
                <span key={i}>
                  {formatLine(line)}
                  {i < part.split('\n').length - 1 && <br />}
                </span>
              ))}
            </span>
          );
        } else {
          return (
            <CodeBlockComponent 
              key={index} 
              block={part} 
              defaultExpanded={codeBlocks.length <= 2}
            />
          );
        }
      })}
      {isStreaming && <span className="cursor">▊</span>}
      {codeBlocks.length > 1 && !isStreaming && (
        <DownloadAllButton codeBlocks={codeBlocks} />
      )}
    </div>
  );
}

// Basic markdown formatting for inline elements
function formatLine(line: string): React.ReactNode {
  // First escape HTML to prevent XSS and unwanted rendering
  let formatted = line
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  
  // Then apply markdown formatting
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  formatted = formatted.replace(/__(.*?)__/g, '<strong>$1</strong>');
  formatted = formatted.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  formatted = formatted.replace(/_([^_]+)_/g, '<em>$1</em>');
  formatted = formatted.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  
  return <span dangerouslySetInnerHTML={{ __html: formatted }} />;
}
