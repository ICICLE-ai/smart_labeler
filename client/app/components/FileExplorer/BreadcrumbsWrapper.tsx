import { NavLink } from "react-router-dom";
import { Button } from "reactstrap";
import styles from "./BreadcrumbsWrapper.module.scss";

const BreadcrumbFragment = ({
  to,
  onClick,
  text,
  delimiter = "/",
  isLast,
}: any) => {
  const fragmentStyle = isLast
    ? `${styles.fragment} ${styles.lastFragment}`
    : styles.fragment;
  if (onClick) {
    return (
      <span className={fragmentStyle}>
        {" "}
        <Button
          color="link"
          className={styles.link}
          onClick={(e) => {
            e.preventDefault();
            to && onClick(to);
          }}
        >
          {text}
        </Button>
        {"\u00A0"}
        {delimiter}
        {"\u00A0"}
      </span>
    );
  }
  if (to) {
    return (
      <span className={fragmentStyle}>
        <NavLink to={to} className={styles.link}>
          {text}
        </NavLink>
        {"\u00A0"}
        {delimiter}
        {"\u00A0"}
      </span>
    );
  }
  return (
    <span className={fragmentStyle}>
      {text}
      {"\u00A0"}
      {`${text !== "..." ? delimiter : ""}`}
      {"\u00A0"}
    </span>
  );
};

const BreadcrumbsWrapper = ({
  breadcrumbs,
  truncate,
  delimiter,
}: any) => {
  let truncatedBreadcrumbs = breadcrumbs;
  if (truncate && breadcrumbs.length >= 5) {
    truncatedBreadcrumbs = [...breadcrumbs.slice(0, 2)];
    truncatedBreadcrumbs.push({ text: "\u2026" });
    truncatedBreadcrumbs.push(
      ...breadcrumbs.slice(breadcrumbs.length - 2, breadcrumbs.length)
    );
  }
  return (
    <div className={styles.box}>
      {truncatedBreadcrumbs.map((item, index) => {
        const { text, to, onClick } = item;
        if (index === truncatedBreadcrumbs.length - 1) {
          return (
            <BreadcrumbFragment text={text} isLast key={index} />
          );
        }
        return (
          <BreadcrumbFragment
            text={text}
            to={to}
            onClick={onClick}
            delimiter={delimiter || "/"}
            key={index}
          />
        );
      })}
    </div>
  );
};

export default BreadcrumbsWrapper;
