import cx from "clsx";
import { Title, Text, Container, Button, Overlay, Group } from "@mantine/core";
import classes from "./HeroImageBackground.module.css";
import { Link } from "@remix-run/react";
import { useAppConfig } from "~/context/AppConfigContext";

const TYPE_SUBTITLES: Record<string, string> = {
  DETECTION: "Object Detection",
  SEGMENTATION: "Semantic Segmentation",
};

export function HeroImageBackground() {
  const { annotatorType } = useAppConfig();
  const subtitle = annotatorType ? (TYPE_SUBTITLES[annotatorType.toUpperCase()] ?? null) : null;

  return (
    <div className={classes.wrapper}>
      <Overlay color="#000" opacity={0.65} zIndex={1} />

      <div className={classes.inner}>
        <Title className={classes.title}>
          <Text component="span" inherit className={classes.highlight}>
            Smart Labeler
          </Text>
          {subtitle && <> : {subtitle}</>}
        </Title>

        <Container size={640}>
          <Text size="lg" className={classes.description}>
            AI-Assisted Data Labeling for Every Research Domain
          </Text>
        </Container>

        <Group gap={15} className={classes.controls}>
          <Link to="/dashboard">
            <Button
              className={cx(classes.control)}
              size="lg"
              variant="gradient"
              gradient={{ from: "blue", to: "cyan", deg: 123 }}
              autoContrast
            >
              Get started
            </Button>
          </Link>
          <div>
            <Button
              component="a"
              href="https://www.youtube.com/watch?v=RlM7ZrZvJqM"
              target="_blank"
              rel="noopener noreferrer"
              className={cx(classes.control, classes.secondaryControl)}
              size="lg"
            >
              Live demo
            </Button>
          </div>
          
        </Group>
      </div>
    </div>
  );
}
