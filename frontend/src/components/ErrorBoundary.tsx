import { Component, ReactNode } from "react";

interface Props { children: ReactNode; }
interface State { hasError: boolean; }

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="min-h-screen flex flex-col items-center justify-center gap-4"
          style={{ backgroundColor: "var(--color-bg-primary)" }}
        >
          <p
            style={{
              fontFamily: "Playfair Display, Georgia, serif",
              fontSize: "18px",
              color: "var(--color-text-primary)",
            }}
          >
            Bir şeyler ters gitti.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              backgroundColor: "var(--color-accent)",
              color: "var(--color-bg-primary)",
              border: "none",
              padding: "10px 24px",
              fontSize: "14px",
              fontWeight: 600,
              letterSpacing: "0.5px",
              cursor: "pointer",
              borderRadius: 0,
            }}
          >
            Sayfayı Yenile
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
