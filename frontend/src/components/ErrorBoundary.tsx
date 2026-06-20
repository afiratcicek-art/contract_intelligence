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
          style={{ backgroundColor: "#F5F2ED" }}
        >
          <p
            style={{
              fontFamily: "Playfair Display, Georgia, serif",
              fontSize: "18px",
              color: "#1C1917",
            }}
          >
            Bir şeyler ters gitti.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              backgroundColor: "#6B5D3F",
              color: "#F5F2ED",
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
